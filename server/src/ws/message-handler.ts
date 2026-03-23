import { v4 as uuidv4 } from 'uuid';
import type {
  ClientMessage,
  ServerMessage,
  PongMessage,
  ErrorMessage,
} from '@my-claudia/shared';
import type { TerminalManager } from '../terminal-manager.js';
import type { ProcessMonitor } from '../utils/process-monitor.js';
import type { initDatabase } from '../storage/db.js';
import { isProcessAlive, killProcessTree } from '../utils/process-tree.js';
import { providerRegistry } from '../providers/registry.js';
import { interactionDispatcher } from '../interactions/interaction-dispatcher.js';
import { permissionManager as pluginPermissionManager } from '../plugins/permissions.js';
import { sendMessage, broadcastToOtherAuthenticatedClients } from './broadcast.js';
import { handlePermissionDecision, handleAskUserAnswer } from './permission-handler.js';
import type { ConnectedClient, ActiveRun } from './types.js';
import type { AgentFeedService } from '../domains/agent-feed/service.js';
import type { TaskOrchestrator } from '../orchestration/types.js';

/** Context object bundling module-level dependencies for handleClientMessage. */
export interface MessageHandlerContext {
  activeRuns: Map<string, ActiveRun>;
  connectedClients: Map<string, ConnectedClient>;
  processMonitor: ProcessMonitor | null;
  handleRunStart: (client: ConnectedClient, message: any, db: any, options: any, clients: Map<string, ConnectedClient>) => Promise<void>;
  cancelRun: (runId: string) => void;
  broadcastPluginState: () => void;
  findProcessPidsByTaskCommand: (taskCommand?: string, excludedPids?: number[]) => Promise<number[]>;
  agentFeedService?: AgentFeedService;
  orchestrator?: TaskOrchestrator;
}

export async function handleClientMessage(
  client: ConnectedClient,
  message: ClientMessage,
  db: ReturnType<typeof initDatabase>,
  clients: Map<string, ConnectedClient>,
  ctx: MessageHandlerContext,
  termMgr?: TerminalManager,
): Promise<void> {
  switch (message.type) {
    case 'auth':
      // Auth is handled in the ws.on('message') handler before this function
      // If we reach here, the client is already authenticated (ignore duplicate auth)
      break;

    case 'ping':
      sendMessage(client.ws, { type: 'pong' } as PongMessage);
      break;

    case 'run_start':
      await ctx.handleRunStart(client, message, db, {}, clients);
      break;

    case 'agent_start':
      // Legacy alias — kept for backward compatibility with older clients.
      // New clients should use claudia_task_submit instead.
      await ctx.handleRunStart(client, {
        type: 'run_start',
        clientRequestId: message.clientRequestId,
        sessionId: message.sessionId,
        input: message.input,
        providerId: message.providerId,
        model: message.model,
      }, db, {}, clients);
      break;

    case 'agent_cancel': {
      let cancelled = false;

      // Find and cancel the active run for this agent session
      for (const [runId, run] of ctx.activeRuns.entries()) {
        if (run.sessionId === message.sessionId && !run.completed) {
          ctx.cancelRun(runId);
          cancelled = true;
          break;
        }
      }

      // Claudia tasks can outlive the in-memory active run map after app/server restarts.
      // Fall back to the latest Claudia-owned orchestrator task for this session so the
      // task card's Cancel action still works for stale "running" sessions.
      if (!cancelled && ctx.orchestrator) {
        const taskRow = db.prepare(
          `SELECT id
           FROM orchestrator_tasks
           WHERE session_id = ? AND initiator = ?
           ORDER BY created_at DESC
           LIMIT 1`
        ).get(message.sessionId, 'claudia') as { id: string } | undefined;

        if (taskRow) {
          try {
            await ctx.orchestrator.killTask(taskRow.id);
          } catch (err) {
            sendMessage(client.ws, {
              type: 'error',
              code: 'TASK_CANCEL_FAILED',
              message: err instanceof Error ? err.message : 'Failed to cancel task',
            } as ErrorMessage);
          }
        }
      }
      break;
    }

    case 'get_agent_feed':
      if (ctx.agentFeedService) {
        const result = ctx.agentFeedService.listItems({
          limit: message.limit,
          before: message.before,
          unreadOnly: message.unreadOnly,
        });
        sendMessage(client.ws, {
          type: 'agent_feed_list',
          items: result.items,
          hasMore: result.hasMore,
          unreadCount: result.unreadCount,
          append: typeof message.before === 'number',
        } as import('@my-claudia/shared').AgentFeedListMessage);
      }
      break;

    case 'mark_feed_read':
      if (ctx.agentFeedService && Array.isArray(message.itemIds)) {
        ctx.agentFeedService.markRead(message.itemIds);
      }
      break;

    case 'dismiss_feed_items':
      if (ctx.agentFeedService && Array.isArray(message.itemIds)) {
        ctx.agentFeedService.dismissItems(message.itemIds);
      }
      break;

    case 'clear_read_feed_items':
      if (ctx.agentFeedService) {
        ctx.agentFeedService.clearRead();
      }
      break;

    case 'claudia_message': {
      // Inline-first Claudia message: run in foreground, promote to background on tool_use or timeout
      const inlineMsg = message as import('@my-claudia/shared').ClaudiaMessageMessage;
      const clientReqId = inlineMsg.clientRequestId;
      const inlineInput = inlineMsg.input?.trim();
      if (!inlineInput) break;
      if (!ctx.orchestrator) {
        sendMessage(client.ws, {
          type: 'claudia_message_failed',
          clientRequestId: clientReqId,
          error: 'Task orchestrator not available',
        } as import('@my-claudia/shared').ClaudiaMessageFailedMessage);
        break;
      }
      if (inlineInput.length > 100_000) {
        sendMessage(client.ws, {
          type: 'claudia_message_failed',
          clientRequestId: clientReqId,
          error: 'Input exceeds 100KB limit',
        } as import('@my-claudia/shared').ClaudiaMessageFailedMessage);
        break;
      }

      const inlineProjectId = inlineMsg.projectId;
      const projectRow = inlineProjectId
        ? db.prepare('SELECT id FROM projects WHERE id = ?').get(inlineProjectId) as { id: string } | undefined
        : undefined;
      if (inlineProjectId && !projectRow) {
        sendMessage(client.ws, {
          type: 'claudia_message_failed',
          clientRequestId: clientReqId,
          error: `Project not found: ${inlineProjectId}`,
        } as import('@my-claudia/shared').ClaudiaMessageFailedMessage);
        break;
      }

      const contextProjectIds = Array.from(new Set((inlineMsg.contextProjectIds || []).filter(Boolean)));
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
        } as import('@my-claudia/shared').ClaudiaMessageFailedMessage);
        break;
      }

      const primaryContextProject = contextProjects.find((project) => project.id === inlineMsg.primaryContextProjectId)
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
      const sessionId = uuidv4();
      const now = Date.now();
      const inlineTitle = inlineInput.replace(/\s+/g, ' ').slice(0, 80);

      // Create ephemeral agent session
      db.prepare(`
        INSERT INTO sessions (id, project_id, name, type, parent_session_id, working_directory, created_at, updated_at)
        VALUES (?, ?, ?, 'agent', NULL, ?, ?, ?)
      `).run(sessionId, inlineProjectId, `Claudia: ${inlineInput.slice(0, 50)}`, sessionWorkingDirectory, now, now);

      let fullContent = '';
      let promoted = false;
      let completed = false;
      const PROMOTE_TIMEOUT_MS = 5_000;

      // Timeout: promote if not completed within 5s
      const promoteTimer = setTimeout(() => {
        if (!completed && !promoted) promote();
      }, PROMOTE_TIMEOUT_MS);

      function persistInlineHistory(status: 'completed' | 'failed', extra?: { summary?: string; error?: string; updatedAt?: number }) {
        const existing = db.prepare(
          'SELECT id FROM orchestrator_tasks WHERE session_id = ? AND initiator = ? ORDER BY created_at DESC LIMIT 1'
        ).get(sessionId, 'claudia') as { id: string } | undefined;
        if (existing) return existing.id;

        const taskId = uuidv4();
        const updatedAt = extra?.updatedAt ?? Date.now();
        db.prepare(`
          INSERT INTO orchestrator_tasks (
            id, parent_task_id, root_task_id, project_id, session_id,
            kind, context_template, status, task, external_id, initiator,
            retry_count, max_retries, result_summary, error_summary,
            created_at, started_at, completed_at, updated_at
          ) VALUES (?, NULL, ?, ?, ?, 'agent', 'agent', ?, ?, NULL, 'claudia', 0, 0, ?, ?, ?, ?, ?, ?)
        `).run(
          taskId,
          taskId,
          inlineProjectId,
          sessionId,
          status,
          inlineInput,
          extra?.summary ?? null,
          extra?.error ?? null,
          now,
          now,
          updatedAt,
          updatedAt,
        );
        return taskId;
      }

      function promote() {
        if (promoted || completed) return;
        promoted = true;
        clearTimeout(promoteTimer);

        // Create orchestrator task for the already-running session
        const taskId = uuidv4();
        const taskNow = Date.now();

        // Insert task record directly — session already exists and run is active
        db.prepare(`
          INSERT INTO orchestrator_tasks (
            id, parent_task_id, root_task_id, project_id, session_id,
            kind, context_template, status, task, external_id, initiator,
            retry_count, max_retries, created_at, started_at, updated_at
          ) VALUES (?, NULL, ?, ?, ?, 'agent', 'agent', 'running', ?, NULL, 'claudia', 0, 0, ?, ?, ?)
        `).run(taskId, taskId, inlineProjectId, sessionId, inlineInput, taskNow, taskNow, taskNow);

        // Notify feed service
        if (ctx.agentFeedService) {
          ctx.agentFeedService.postItem({
            taskId,
            sessionId,
            projectId: inlineProjectId,
            source: 'manual',
            title: inlineTitle,
            summary: inlineInput,
            status: 'running',
          });
        }

        // Send promotion notice to client
        sendMessage(client.ws, {
          type: 'claudia_message_promoted',
          clientRequestId: clientReqId,
          taskId,
          sessionId,
        } as import('@my-claudia/shared').ClaudiaMessagePromotedMessage);

        // From now on, deltas go as claudia_task_delta
        // Completion will be handled by the wrapper's run_completed handler below
      }

      // Build intercepting wrapper client
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
                } as import('@my-claudia/shared').ClaudiaMessageDeltaMessage);
              } else {
                // After promotion, use task delta channel
                // Find the task ID from the DB
                const taskRow = db.prepare(
                  'SELECT id FROM orchestrator_tasks WHERE session_id = ? AND initiator = ? ORDER BY created_at DESC LIMIT 1'
                ).get(sessionId, 'claudia') as { id: string } | undefined;
                if (taskRow) {
                  for (const [, c] of ctx.connectedClients) {
                    if (c.authenticated) sendMessage(c.ws, {
                      type: 'claudia_task_delta',
                      taskId: taskRow.id,
                      content: text,
                    } as import('@my-claudia/shared').ClaudiaTaskDeltaMessage);
                  }
                }
              }
            } else if (evt.type === 'tool_use') {
              // Tool use detected — promote immediately
              if (!promoted) promote();
            } else if (evt.type === 'run_completed') {
              completed = true;
              clearTimeout(promoteTimer);
              if (!promoted) {
                const stripped = fullContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                persistInlineHistory('completed', {
                  summary: stripped.slice(0, 200) || 'Task completed',
                });
                // Fast inline completion
                sendMessage(client.ws, {
                  type: 'claudia_message_completed',
                  clientRequestId: clientReqId,
                  responseText: fullContent,
                } as import('@my-claudia/shared').ClaudiaMessageCompletedMessage);
              } else {
                // Promoted task completed — update via orchestrator
                const taskRow = db.prepare(
                  'SELECT id FROM orchestrator_tasks WHERE session_id = ? AND initiator = ? ORDER BY created_at DESC LIMIT 1'
                ).get(sessionId, 'claudia') as { id: string } | undefined;
                if (taskRow) {
                  const summary = fullContent.slice(0, 200) || 'Task completed';
                  db.prepare(
                    'UPDATE orchestrator_tasks SET status = ?, result_summary = ?, completed_at = ?, updated_at = ? WHERE id = ?'
                  ).run('completed', summary, Date.now(), Date.now(), taskRow.id);
                  // Broadcast update
                  for (const [, c] of ctx.connectedClients) {
                    if (c.authenticated) sendMessage(c.ws, {
                      type: 'claudia_task_update',
                      taskId: taskRow.id,
                      status: 'completed',
                      sessionId,
                      title: inlineTitle,
                      responseText: fullContent,
                      updatedAt: Date.now(),
                    } as import('@my-claudia/shared').ClaudiaTaskUpdateMessage);
                  }
                  // Update feed
                  if (ctx.agentFeedService) {
                    const feedItem = ctx.agentFeedService.findByTaskId(taskRow.id);
                    if (feedItem) ctx.agentFeedService.updateItemStatus(feedItem.id, 'completed', { summary });
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
                } as import('@my-claudia/shared').ClaudiaMessageFailedMessage);
                return;
              }
              if (promoted) {
                const taskRow = db.prepare(
                  'SELECT id FROM orchestrator_tasks WHERE session_id = ? AND initiator = ? ORDER BY created_at DESC LIMIT 1'
                ).get(sessionId, 'claudia') as { id: string } | undefined;
                if (taskRow) {
                  db.prepare(
                    'UPDATE orchestrator_tasks SET status = ?, error_summary = ?, completed_at = ?, updated_at = ? WHERE id = ?'
                  ).run('failed', errorMsg, Date.now(), Date.now(), taskRow.id);
                  for (const [, c] of ctx.connectedClients) {
                    if (c.authenticated) sendMessage(c.ws, {
                      type: 'claudia_task_update',
                      taskId: taskRow.id,
                      status: 'failed',
                      sessionId,
                      error: errorMsg,
                      updatedAt: Date.now(),
                    } as import('@my-claudia/shared').ClaudiaTaskUpdateMessage);
                  }
                  if (ctx.agentFeedService) {
                    const feedItem = ctx.agentFeedService.findByTaskId(taskRow.id);
                    if (feedItem) ctx.agentFeedService.updateItemStatus(feedItem.id, 'failed', { error: errorMsg });
                  }
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
        providerId: inlineMsg.providerId,
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
        } as import('@my-claudia/shared').ClaudiaMessageFailedMessage);
      });

      break;
    }

    case 'claudia_task_submit': {
      if (!ctx.orchestrator) {
        sendMessage(client.ws, { type: 'error', code: 'NO_ORCHESTRATOR', message: 'Task orchestrator not available' } as ErrorMessage);
        break;
      }
      const taskInput = message.input?.trim();
      if (!taskInput) break;
      // Input length limit: 100KB
      if (taskInput.length > 100_000) {
        sendMessage(client.ws, { type: 'error', code: 'INPUT_TOO_LARGE', message: 'Task input exceeds 100KB limit' } as ErrorMessage);
        break;
      }
      // Validate projectId exists
      const projectRow = message.projectId
        ? db.prepare('SELECT id FROM projects WHERE id = ?').get(message.projectId) as { id: string } | undefined
        : undefined;
      if (message.projectId && !projectRow) {
        sendMessage(client.ws, { type: 'error', code: 'PROJECT_NOT_FOUND', message: `Project not found: ${message.projectId}` } as ErrorMessage);
        break;
      }
      const title = taskInput.replace(/\s+/g, ' ').slice(0, 80);
      try {
        const taskId = await ctx.orchestrator.spawnTask(null, {
          task: taskInput,
          projectId: message.projectId,
          providerId: message.providerId,
          initiator: 'claudia',
          feed: { source: 'manual', title },
        });
        // Look up the spawned task to get its sessionId
        const spawnedTask = ctx.orchestrator.getTask(taskId);
        sendMessage(client.ws, {
          type: 'claudia_task_created',
          clientRequestId: message.clientRequestId,
          taskId,
          sessionId: spawnedTask?.sessionId ?? '',
          title,
          status: 'queued',
        } as import('@my-claudia/shared').ClaudiaTaskCreatedMessage);
      } catch (err) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_SPAWN_FAILED',
          message: err instanceof Error ? err.message : 'Failed to spawn task',
        } as ErrorMessage);
      }
      break;
    }

    case 'claudia_task_continue': {
      if (!ctx.orchestrator) {
        sendMessage(client.ws, { type: 'error', code: 'NO_ORCHESTRATOR', message: 'Task orchestrator not available' } as ErrorMessage);
        break;
      }

      const continueInput = message.input?.trim();
      if (!continueInput) break;

      const parentTask = ctx.orchestrator.getTask(message.taskId);
      if (!parentTask) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_NOT_FOUND',
          message: `Task not found: ${message.taskId}`,
        } as ErrorMessage);
        break;
      }

      const title = continueInput.replace(/\s+/g, ' ').slice(0, 80);
      try {
        const taskId = await ctx.orchestrator.spawnTask(message.taskId, {
          task: continueInput,
          projectId: parentTask.projectId ?? undefined,
          providerId: parentTask.providerId,
          initiator: 'claudia',
          feed: { source: 'manual', title },
        });
        const spawnedTask = ctx.orchestrator.getTask(taskId);
        sendMessage(client.ws, {
          type: 'claudia_task_created',
          clientRequestId: message.clientRequestId,
          taskId,
          sessionId: spawnedTask?.sessionId ?? '',
          title,
          status: 'queued',
        } as import('@my-claudia/shared').ClaudiaTaskCreatedMessage);
      } catch (err) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_CONTINUE_FAILED',
          message: err instanceof Error ? err.message : 'Failed to continue task',
        } as ErrorMessage);
      }
      break;
    }

    case 'claudia_task_cancel': {
      if (!ctx.orchestrator) {
        sendMessage(client.ws, { type: 'error', code: 'NO_ORCHESTRATOR', message: 'Task orchestrator not available' } as ErrorMessage);
        break;
      }

      const task = ctx.orchestrator.getTask(message.taskId);
      if (!task) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_NOT_FOUND',
          message: `Task not found: ${message.taskId}`,
        } as ErrorMessage);
        break;
      }

      try {
        await ctx.orchestrator.killTask(message.taskId);
      } catch (err) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_CANCEL_FAILED',
          message: err instanceof Error ? err.message : 'Failed to cancel task',
        } as ErrorMessage);
      }
      break;
    }

    case 'run_cancel':
      ctx.cancelRun(message.runId);
      break;

    case 'kill_leaked_processes':
      if (ctx.processMonitor) {
        console.log('[ProcessMonitor] Manual kill triggered by client');
        const result = await ctx.processMonitor.cleanupNow();
        sendMessage(client.ws, {
          type: 'process_cleanup_result',
          status: result.status,
          leakedCount: result.leakedCount,
          killedCount: result.killedCount,
          activeRunCount: result.activeRunCount,
        });
      }
      break;

    case 'stop_background_task': {
      const { sessionId: targetSessionId, taskId, taskRootPid, cliPid, taskCommand } = message;

      const directPid = taskRootPid;
      if (directPid && isProcessAlive(directPid)) {
        console.log(`[StopTask] Direct PID stop for task ${taskId}: pid=${directPid}`);
        killProcessTree(directPid)
          .then(({ killed, failed }) => {
            const stopped = killed.length > 0 && failed.length === 0 && !isProcessAlive(directPid);
            sendMessage(client.ws, {
              type: 'task_notification',
              runId: '',
              sessionId: targetSessionId,
              taskId,
              status: stopped ? 'stopped' : 'failed',
              message: stopped
                ? `Task stopped by PID ${directPid}`
                : `Failed to stop PID ${directPid}`,
              cliPid,
              taskRootPid,
            } as import('@my-claudia/shared').TaskNotificationMessage);
          })
          .catch(err => {
            console.error(`[StopTask] Direct PID stop failed for task ${taskId}:`, err);
            sendMessage(client.ws, {
              type: 'task_notification',
              runId: '',
              sessionId: targetSessionId,
              taskId,
              status: 'failed',
              message: `PID stop failed: ${err instanceof Error ? err.message : String(err)}`,
              cliPid,
              taskRootPid,
            } as import('@my-claudia/shared').TaskNotificationMessage);
          });
        break;
      }

      const matchedPids = await ctx.findProcessPidsByTaskCommand(taskCommand, [cliPid, taskRootPid].filter((pid): pid is number => typeof pid === 'number'));
      if (matchedPids.length > 0) {
        console.log(`[StopTask] Command-matched stop for task ${taskId}: pids=[${matchedPids.join(',')}]`);
        const killResults = await Promise.all(matchedPids.map(pid => killProcessTree(pid)));
        const failed = killResults.flatMap(result => result.failed);
        const killed = killResults.flatMap(result => result.killed);
        sendMessage(client.ws, {
          type: 'task_notification',
          runId: '',
          sessionId: targetSessionId,
          taskId,
          status: killed.length > 0 && failed.length === 0 ? 'stopped' : 'failed',
          message: killed.length > 0 && failed.length === 0
            ? `Task stopped by command match (${matchedPids.join(', ')})`
            : `Failed to stop command-matched PID(s): ${matchedPids.join(', ')}`,
          cliPid,
          taskRootPid,
        } as import('@my-claudia/shared').TaskNotificationMessage);
        break;
      }

      // Gather provider type and SDK session ID from multiple sources
      const targetRun = [...ctx.activeRuns.values()].find(r => r.sessionId === targetSessionId);
      let resolvedProviderType = targetRun?.providerType;
      let resolvedSdkSessionId = targetRun?.providerSessionId;

      // If active run doesn't have SDK session ID (not yet attached), look up from DB
      if (!resolvedSdkSessionId) {
        const sessionRow = db.prepare('SELECT sdk_session_id FROM sessions WHERE id = ?')
          .get(targetSessionId) as { sdk_session_id: string | null } | undefined;
        resolvedSdkSessionId = sessionRow?.sdk_session_id || undefined;
      }

      // If no provider type from active run, look up from DB
      if (!resolvedProviderType) {
        const providerRow = db.prepare(`
          SELECT pr.type FROM sessions s
          LEFT JOIN projects p ON s.project_id = p.id
          LEFT JOIN providers pr ON pr.id = COALESCE(s.provider_id, p.provider_id)
          WHERE s.id = ? AND pr.type IS NOT NULL
        `).get(targetSessionId) as { type: string } | undefined;
        resolvedProviderType = providerRow?.type;
      }

      if (resolvedProviderType && resolvedSdkSessionId) {
        const adapter = providerRegistry.get(resolvedProviderType);
        if (adapter?.stopTask) {
          console.log(`[StopTask] Stopping task ${taskId}: adapter=${resolvedProviderType} sdkSession=${resolvedSdkSessionId}`);
          adapter.stopTask(resolvedSdkSessionId, taskId)
            .then((killed) => {
              // Notify frontend — include whether processes were actually killed
              sendMessage(client.ws, {
                type: 'task_notification',
                runId: targetRun?.runId || '',
                sessionId: targetSessionId,
                taskId,
                status: killed !== false ? 'stopped' : 'failed',
                message: killed !== false ? 'Task stopped by user' : 'No processes found to kill',
              } as import('@my-claudia/shared').TaskNotificationMessage);
            })
            .catch(err => {
              console.error(`[StopTask] Failed to stop task ${taskId}:`, err);
              sendMessage(client.ws, {
                type: 'task_notification',
                runId: targetRun?.runId || '',
                sessionId: targetSessionId,
                taskId,
                status: 'failed',
                message: `Stop failed: ${err instanceof Error ? err.message : String(err)}`,
              } as import('@my-claudia/shared').TaskNotificationMessage);
            });
          break;
        }
      }

      console.warn(`[StopTask] Cannot stop task ${taskId} in session ${targetSessionId} — providerType=${resolvedProviderType} sdkSessionId=${resolvedSdkSessionId}`);
      break;
    }

    case 'permission_decision':
      handlePermissionDecision(message, ctx.activeRuns, ctx.connectedClients);
      break;

    case 'ask_user_answer':
      handleAskUserAnswer(message, ctx.activeRuns, ctx.connectedClients);
      break;

    case 'interaction_response': {
      const resolved = interactionDispatcher.resolve(message.interactionId, message.response);
      if (resolved) {
        // Broadcast interaction_resolved to all clients
        for (const [, run] of ctx.activeRuns) {
          if (run.sessionId === message.sessionId) {
            const resolvedEvent = {
              type: 'interaction_resolved' as const,
              interactionId: message.interactionId,
              sessionId: message.sessionId,
            };
            sendMessage(run.client.ws, resolvedEvent as import('@my-claudia/shared').InteractionResolvedMessage);
            if (clients) broadcastToOtherAuthenticatedClients(clients, run.clientId, resolvedEvent as ServerMessage);
            break;
          }
        }
      } else {
        console.warn(`[InteractionResponse] No pending interaction for ${message.interactionId}`);
      }
      break;
    }

    case 'terminal_open': {
      if (!termMgr) break;
      const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(message.projectId) as { root_path: string } | undefined;
      // Pass the target cwd to TerminalManager — it spawns at $HOME then cd's to this path
      // (avoids macOS TCC permission dialogs that block pty.spawn)
      const cwd = message.workingDirectory || project?.root_path || process.env.HOME || '/';
      try {
        termMgr.create(message.terminalId, client.id, cwd, message.cols, message.rows);
        sendMessage(client.ws, { type: 'terminal_opened', terminalId: message.terminalId, success: true });
      } catch (err) {
        sendMessage(client.ws, {
          type: 'terminal_opened',
          terminalId: message.terminalId,
          success: false,
          error: err instanceof Error ? err.message : 'Failed to create terminal',
        });
      }
      break;
    }

    case 'terminal_input':
      termMgr?.write(message.terminalId, message.data);
      break;

    case 'terminal_resize':
      termMgr?.resize(message.terminalId, message.cols, message.rows);
      break;

    case 'terminal_close':
      termMgr?.destroy(message.terminalId);
      break;

    case 'terminal_detach':
      termMgr?.detachTerminal(message.terminalId, client.id);
      break;

    case 'terminal_attach': {
      if (!termMgr) break;
      const result = termMgr.attach(message.terminalId, client.id, message.cols, message.rows);
      sendMessage(client.ws, {
        type: 'terminal_attached',
        terminalId: message.terminalId,
        success: result.success,
        scrollback: result.scrollback,
        error: result.error,
      });
      break;
    }

    case 'plugin_permission_response': {
      const { pluginId, granted, permanently } = message as import('@my-claudia/shared').PluginPermissionResponseMessage;
      pluginPermissionManager.respondToRequest(pluginId, granted, permanently);
      ctx.broadcastPluginState();
      break;
    }

    default:
      sendMessage(client.ws, {
        type: 'error',
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Unknown message type: ${(message as { type: string }).type}`
      } as ErrorMessage);
  }
}
