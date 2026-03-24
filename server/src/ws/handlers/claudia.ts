import { v4 as uuidv4 } from 'uuid';
import type {
  ClaudiaMessageMessage,
  ClaudiaTaskSubmitMessage,
  ClaudiaTaskContinueMessage,
  ClaudiaTaskCancelMessage,
  ClaudiaMessageFailedMessage,
  ClaudiaMessageDeltaMessage,
  ClaudiaMessageCompletedMessage,
  ClaudiaMessagePromotedMessage,
  ClaudiaTaskCreatedMessage,
  ClaudiaTaskDeltaMessage,
  ClaudiaTaskUpdateMessage,
  ErrorMessage,
} from '@my-claudia/shared';
import type { BranchAction } from '@my-claudia/shared';
import type { ConnectedClient, ActiveRun } from '../types.js';
import type { initDatabase } from '../../storage/db.js';
import type { NotificationFeedService } from '../../domains/notification-feed/service.js';
import type { TaskOrchestrator } from '../../orchestration/types.js';
import { ClaudiaBranchService } from '../../services/claudia-branch-service.js';
import { sendMessage } from '../broadcast.js';

interface ClaudiaHandlerContext {
  activeRuns: Map<string, ActiveRun>;
  connectedClients: Map<string, ConnectedClient>;
  handleRunStart: (client: ConnectedClient, message: any, db: any, options: any, clients: Map<string, ConnectedClient>) => Promise<void>;
  notificationService?: NotificationFeedService;
  orchestrator?: TaskOrchestrator;
}

export async function handleClaudiaMessage(
  client: ConnectedClient,
  message: ClaudiaMessageMessage,
  db: ReturnType<typeof initDatabase>,
  clients: Map<string, ConnectedClient>,
  ctx: ClaudiaHandlerContext,
): Promise<void> {
  const clientReqId = message.clientRequestId;
  const inlineInput = message.input?.trim();
  if (!inlineInput) return;

  if (!ctx.orchestrator) {
    sendMessage(client.ws, {
      type: 'claudia_message_failed',
      clientRequestId: clientReqId,
      error: 'Task orchestrator not available',
    } as ClaudiaMessageFailedMessage);
    return;
  }

  if (inlineInput.length > 100_000) {
    sendMessage(client.ws, {
      type: 'claudia_message_failed',
      clientRequestId: clientReqId,
      error: 'Input exceeds 100KB limit',
    } as ClaudiaMessageFailedMessage);
    return;
  }

  const inlineProjectId = message.projectId;
  const projectRow = inlineProjectId
    ? db.prepare('SELECT id FROM projects WHERE id = ?').get(inlineProjectId) as { id: string } | undefined
    : undefined;
  if (inlineProjectId && !projectRow) {
    sendMessage(client.ws, {
      type: 'claudia_message_failed',
      clientRequestId: clientReqId,
      error: `Project not found: ${inlineProjectId}`,
    } as ClaudiaMessageFailedMessage);
    return;
  }

  // Validate context projects
  const contextProjectIds = Array.from(new Set((message.contextProjectIds || []).filter(Boolean)));
  const contextProjects = contextProjectIds.length > 0
    ? db.prepare(`
        SELECT id, name, root_path
        FROM projects
        WHERE id IN (${contextProjectIds.map(() => '?').join(',')})
      `).all(...contextProjectIds) as Array<{ id: string; name: string; root_path: string | null }>
    : [];
  if (contextProjects.length !== contextProjectIds.length) {
    const foundIds = new Set(contextProjects.map((project) => project.id));
    const missingIds = contextProjectIds.filter((id) => !foundIds.has(id));
    sendMessage(client.ws, {
      type: 'claudia_message_failed',
      clientRequestId: clientReqId,
      error: `Context project(s) not found: ${missingIds.join(', ')}`,
    } as ClaudiaMessageFailedMessage);
    return;
  }

  const primaryContextProject = contextProjects.find((project) => project.id === message.primaryContextProjectId)
    ?? contextProjects[0]
    ?? null;
  const sessionWorkingDirectory = primaryContextProject?.root_path || null;
  const contextSystemPrompt = contextProjects.length > 0
    ? [
        'Attached project context:',
        ...contextProjects.map((project, index) => {
          const primaryTag = primaryContextProject?.id === project.id ? ' [primary]' : '';
          const rootInfo = project.root_path ? project.root_path : 'no root path configured';
          return `${index + 1}. ${project.name} (${project.id})${primaryTag} — root: ${rootInfo}`;
        }),
        '',
        'Use the primary attached project as the active workspace for file and shell operations unless the user says otherwise.',
      ].join('\n')
    : undefined;
  const now = Date.now();
  const inlineTitle = inlineInput.replace(/\s+/g, ' ').slice(0, 80);

  // Branch allocation
  const branchService = new ClaudiaBranchService(db);
  const freshSessionId = uuidv4();
  const allocation = branchService.allocateBranch({
    hostProjectId: inlineProjectId,
    activeBranchId: message.activeBranchId,
    forceNew: message.forceNewBranch,
    title: inlineTitle,
    sessionId: freshSessionId,
  });

  const sessionId = allocation.sessionId;
  const branchId = allocation.branchId;
  const branchAction: BranchAction = allocation.action;
  const contextReset = allocation.contextReset;
  const isSessionReuse = allocation.action === 'reused' && sessionId !== freshSessionId;
  if (branchAction !== 'forked') {
    branchService.setActiveBranchId(inlineProjectId, branchId);
  }

  // Create new session only if not reusing
  if (!isSessionReuse) {
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, type, parent_session_id, working_directory, created_at, updated_at)
      VALUES (?, ?, ?, 'agent', NULL, ?, ?, ?)
    `).run(sessionId, inlineProjectId, `Claudia: ${inlineInput.slice(0, 50)}`, sessionWorkingDirectory, now, now);
    branchService.attachSession(branchId, sessionId);
  }

  let fullContent = '';
  let promoted = false;
  let completed = false;
  const PROMOTE_TIMEOUT_MS = 5_000;

  const promoteTimer = setTimeout(() => {
    if (!completed && !promoted) promote();
  }, PROMOTE_TIMEOUT_MS);

  function persistInlineHistory(status: 'completed' | 'failed', extra?: { summary?: string; error?: string; updatedAt?: number }) {
    const existing = db.prepare(
      'SELECT id FROM orchestrator_tasks WHERE external_id = ? AND initiator = ? LIMIT 1'
    ).get(clientReqId, 'claudia') as { id: string } | undefined;
    if (existing) return existing.id;

    const taskId = uuidv4();
    const updatedAt = extra?.updatedAt ?? Date.now();
    db.prepare(`
      INSERT INTO orchestrator_tasks (
        id, parent_task_id, root_task_id, project_id, session_id, branch_id, branch_action, context_reset,
        kind, context_template, status, task, external_id, initiator,
        retry_count, max_retries, result_summary, error_summary,
        response_text, tool_count,
        created_at, started_at, completed_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'agent', 'agent', ?, ?, ?, 'claudia', 0, 0, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      taskId, taskId, inlineProjectId, sessionId, branchId, branchAction, contextReset ? 1 : 0,
      status, inlineInput, clientReqId,
      extra?.summary ?? null, extra?.error ?? null,
      status === 'completed' ? fullContent : null, null,
      now, now, updatedAt, updatedAt,
    );
    branchService.updateBranchTask(branchId, taskId, sessionId);
    return taskId;
  }

  function promote() {
    if (promoted || completed) return;
    promoted = true;
    clearTimeout(promoteTimer);

    const taskId = uuidv4();
    const taskNow = Date.now();

    db.prepare(`
      INSERT INTO orchestrator_tasks (
        id, parent_task_id, root_task_id, project_id, session_id, branch_id, branch_action, context_reset,
        kind, context_template, status, task, external_id, initiator,
        retry_count, max_retries, response_text, tool_count, created_at, started_at, updated_at
      ) VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 'agent', 'agent', 'running', ?, ?, 'claudia', 0, 0, ?, ?, ?, ?, ?)
    `).run(
      taskId, taskId, inlineProjectId, sessionId, branchId, branchAction, contextReset ? 1 : 0,
      inlineInput, clientReqId, null, null, taskNow, taskNow, taskNow,
    );

    branchService.updateBranchTask(branchId, taskId, sessionId);

    if (ctx.notificationService) {
      ctx.notificationService.postItem({
        taskId, sessionId, projectId: inlineProjectId,
        source: 'manual', title: inlineTitle, summary: inlineInput, status: 'running',
      });
    }

    sendMessage(client.ws, {
      type: 'claudia_message_promoted',
      clientRequestId: clientReqId,
      taskId, projectId: inlineProjectId, sessionId, branchId, branchAction, contextReset,
    } as ClaudiaMessagePromotedMessage);
  }

  // Build intercepting wrapper client
  let toolCount = 0;
  const wrapperWs = {
    readyState: 1,
    send: (data: string) => {
      try {
        const evt = JSON.parse(data);
        if (evt.type === 'delta') {
          const text = evt.content || '';
          fullContent += text;
          if (!promoted) {
            sendMessage(client.ws, {
              type: 'claudia_message_delta',
              clientRequestId: clientReqId,
              content: text,
            } as ClaudiaMessageDeltaMessage);
          } else {
            const taskRow = db.prepare(
              'SELECT id FROM orchestrator_tasks WHERE external_id = ? AND initiator = ? LIMIT 1'
            ).get(clientReqId, 'claudia') as { id: string } | undefined;
            if (taskRow) {
              for (const [, c] of ctx.connectedClients) {
                if (c.authenticated) sendMessage(c.ws, {
                  type: 'claudia_task_delta',
                  taskId: taskRow.id,
                  content: text,
                } as ClaudiaTaskDeltaMessage);
              }
            }
          }
        } else if (evt.type === 'tool_use') {
          toolCount++;
          if (!promoted) promote();
        } else if (evt.type === 'run_completed') {
          completed = true;
          clearTimeout(promoteTimer);
          if (!promoted) {
            const stripped = fullContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            persistInlineHistory('completed', { summary: stripped.slice(0, 200) || 'Task completed' });
            sendMessage(client.ws, {
              type: 'claudia_message_completed',
              clientRequestId: clientReqId,
              responseText: fullContent,
            } as ClaudiaMessageCompletedMessage);
          } else {
            const taskRow = db.prepare(
              'SELECT id FROM orchestrator_tasks WHERE external_id = ? AND initiator = ? LIMIT 1'
            ).get(clientReqId, 'claudia') as { id: string } | undefined;
            if (taskRow) {
              const summary = fullContent.slice(0, 200) || 'Task completed';
              db.prepare(
                'UPDATE orchestrator_tasks SET status = ?, result_summary = ?, response_text = ?, tool_count = ?, completed_at = ?, updated_at = ? WHERE id = ?'
              ).run('completed', summary, fullContent, toolCount, Date.now(), Date.now(), taskRow.id);
              for (const [, c] of ctx.connectedClients) {
                if (c.authenticated) sendMessage(c.ws, {
                  type: 'claudia_task_update',
                  taskId: taskRow.id, status: 'completed', sessionId, branchId, branchAction, contextReset,
                  title: inlineTitle, responseText: fullContent, toolCount, updatedAt: Date.now(),
                } as ClaudiaTaskUpdateMessage);
              }
              if (ctx.notificationService) {
                const feedItem = ctx.notificationService.findByTaskId(taskRow.id);
                if (feedItem) ctx.notificationService.updateItemStatus(feedItem.id, 'completed', { summary });
              }
            }
          }
          clients.delete(wrapperClientId);
        } else if (evt.type === 'run_failed') {
          completed = true;
          clearTimeout(promoteTimer);
          clients.delete(wrapperClientId);
          const errorMsg = evt.error || 'Task failed';
          if (!promoted) {
            persistInlineHistory('failed', { error: errorMsg });
            sendMessage(client.ws, {
              type: 'claudia_message_failed',
              clientRequestId: clientReqId,
              error: errorMsg,
            } as ClaudiaMessageFailedMessage);
            return;
          }
          const taskRow = db.prepare(
            'SELECT id FROM orchestrator_tasks WHERE external_id = ? AND initiator = ? LIMIT 1'
          ).get(clientReqId, 'claudia') as { id: string } | undefined;
          if (taskRow) {
            db.prepare(
              'UPDATE orchestrator_tasks SET status = ?, error_summary = ?, response_text = ?, tool_count = ?, completed_at = ?, updated_at = ? WHERE id = ?'
            ).run('failed', errorMsg, fullContent || null, toolCount, Date.now(), Date.now(), taskRow.id);
            for (const [, c] of ctx.connectedClients) {
              if (c.authenticated) sendMessage(c.ws, {
                type: 'claudia_task_update',
                taskId: taskRow.id, status: 'failed', sessionId, branchId, branchAction, contextReset,
                error: errorMsg, responseText: fullContent || undefined, toolCount, updatedAt: Date.now(),
              } as ClaudiaTaskUpdateMessage);
            }
            if (ctx.notificationService) {
              const feedItem = ctx.notificationService.findByTaskId(taskRow.id);
              if (feedItem) ctx.notificationService.updateItemStatus(feedItem.id, 'failed', { error: errorMsg });
            }
          }
        }
      } catch { /* ignore */ }
    },
  };

  const wrapperClientId = `claudia-inline-${clientReqId}`;
  const wrapperClient = {
    id: wrapperClientId,
    ws: wrapperWs as any,
    isAlive: true,
    isLocal: true,
    authenticated: true,
  } as ConnectedClient;
  clients.set(wrapperClientId, wrapperClient);

  // Start the run
  ctx.handleRunStart(wrapperClient, {
    type: 'run_start',
    clientRequestId: clientReqId,
    sessionId,
    input: inlineInput,
    providerId: message.providerId,
    systemContext: contextSystemPrompt,
    _contextTemplate: 'agent',
  }, db, {}, clients).catch((err) => {
    completed = true;
    clearTimeout(promoteTimer);
    clients.delete(wrapperClientId);
    sendMessage(client.ws, {
      type: 'claudia_message_failed',
      clientRequestId: clientReqId,
      error: err instanceof Error ? err.message : 'Failed to start inline run',
    } as ClaudiaMessageFailedMessage);
  });
}

export async function handleClaudiaTaskSubmit(
  client: ConnectedClient,
  message: ClaudiaTaskSubmitMessage,
  db: ReturnType<typeof initDatabase>,
  orchestrator: TaskOrchestrator,
): Promise<void> {
  const taskInput = message.input?.trim();
  if (!taskInput) return;

  if (taskInput.length > 100_000) {
    sendMessage(client.ws, { type: 'error', code: 'INPUT_TOO_LARGE', message: 'Task input exceeds 100KB limit' } as ErrorMessage);
    return;
  }

  const projectRow = message.projectId
    ? db.prepare('SELECT id FROM projects WHERE id = ?').get(message.projectId) as { id: string } | undefined
    : undefined;
  if (message.projectId && !projectRow) {
    sendMessage(client.ws, { type: 'error', code: 'PROJECT_NOT_FOUND', message: `Project not found: ${message.projectId}` } as ErrorMessage);
    return;
  }

  const title = taskInput.replace(/\s+/g, ' ').slice(0, 80);
  try {
    const submitBranchService = new ClaudiaBranchService(db);
    const submitSessionId = uuidv4();
    const submitAllocation = submitBranchService.allocateBranch({
      hostProjectId: message.projectId,
      activeBranchId: message.activeBranchId,
      forceNew: message.forceNewBranch,
      title,
      sessionId: submitSessionId,
    });
    if (submitAllocation.action !== 'forked') {
      submitBranchService.setActiveBranchId(message.projectId, submitAllocation.branchId);
    }

    const taskId = await orchestrator.spawnTask(null, {
      task: taskInput,
      projectId: message.projectId,
      providerId: message.providerId,
      initiator: 'claudia',
      branchId: submitAllocation.branchId,
      branchAction: submitAllocation.action,
      contextReset: submitAllocation.contextReset,
      feed: { source: 'manual', title },
    });
    submitBranchService.updateBranchTask(submitAllocation.branchId, taskId);

    const spawnedTask = orchestrator.getTask(taskId);
    sendMessage(client.ws, {
      type: 'claudia_task_created',
      clientRequestId: message.clientRequestId,
      taskId,
      projectId: message.projectId,
      sessionId: spawnedTask?.sessionId ?? '',
      branchId: submitAllocation.branchId,
      branchAction: submitAllocation.action,
      title,
      status: 'queued',
    } as ClaudiaTaskCreatedMessage);
  } catch (err) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_SPAWN_FAILED',
      message: err instanceof Error ? err.message : 'Failed to spawn task',
    } as ErrorMessage);
  }
}

export async function handleClaudiaTaskContinue(
  client: ConnectedClient,
  message: ClaudiaTaskContinueMessage,
  db: ReturnType<typeof initDatabase>,
  orchestrator: TaskOrchestrator,
): Promise<void> {
  const continueInput = message.input?.trim();
  if (!continueInput) return;

  const parentTask = orchestrator.getTask(message.taskId);
  if (!parentTask) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_NOT_FOUND',
      message: `Task not found: ${message.taskId}`,
    } as ErrorMessage);
    return;
  }

  const title = continueInput.replace(/\s+/g, ' ').slice(0, 80);
  try {
    const continueBranchService = new ClaudiaBranchService(db);
    const continueSessionId = uuidv4();
    const continueAllocation = continueBranchService.allocateForContinue({
      taskBranchId: parentTask.branchId,
      hostProjectId: parentTask.projectId ?? '',
      title,
      sessionId: continueSessionId,
    });
    if (continueAllocation.action !== 'forked' && parentTask.projectId) {
      continueBranchService.setActiveBranchId(parentTask.projectId, continueAllocation.branchId);
    }

    const taskId = await orchestrator.spawnTask(message.taskId, {
      task: continueInput,
      projectId: parentTask.projectId ?? undefined,
      providerId: parentTask.providerId,
      initiator: 'claudia',
      branchId: continueAllocation.branchId,
      branchAction: continueAllocation.action,
      contextReset: continueAllocation.contextReset,
      feed: { source: 'manual', title },
    });
    continueBranchService.updateBranchTask(continueAllocation.branchId, taskId);

    const spawnedTask = orchestrator.getTask(taskId);
    sendMessage(client.ws, {
      type: 'claudia_task_created',
      clientRequestId: message.clientRequestId,
      taskId,
      projectId: parentTask.projectId ?? '',
      sessionId: spawnedTask?.sessionId ?? '',
      branchId: continueAllocation.branchId,
      branchAction: continueAllocation.action,
      title,
      status: 'queued',
      contextReset: continueAllocation.contextReset,
    } as ClaudiaTaskCreatedMessage);
  } catch (err) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_CONTINUE_FAILED',
      message: err instanceof Error ? err.message : 'Failed to continue task',
    } as ErrorMessage);
  }
}

export async function handleClaudiaTaskCancel(
  client: ConnectedClient,
  message: ClaudiaTaskCancelMessage,
  orchestrator: TaskOrchestrator,
): Promise<void> {
  const task = orchestrator.getTask(message.taskId);
  if (!task) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_NOT_FOUND',
      message: `Task not found: ${message.taskId}`,
    } as ErrorMessage);
    return;
  }

  try {
    await orchestrator.killTask(message.taskId);
  } catch (err) {
    sendMessage(client.ws, {
      type: 'error',
      code: 'TASK_CANCEL_FAILED',
      message: err instanceof Error ? err.message : 'Failed to cancel task',
    } as ErrorMessage);
  }
}
