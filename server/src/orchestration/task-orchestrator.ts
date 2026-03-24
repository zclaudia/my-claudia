/**
 * TaskOrchestrator — unified task orchestration layer.
 *
 * Phase 2: Only owns kind='agent' tasks.
 * External tasks (supervision/workflow/scheduled) are mirrored via syncExternalTask().
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type { NotificationSource } from '@my-claudia/shared';
import type {
  TaskOrchestrator,
  SpawnTaskConfig,
  TaskResult,
  OrchestratorTask,
  ExternalTaskSync,
  TaskStatus,
} from './types.js';
import { TaskRepository } from './repository.js';

const MAX_CONCURRENT_AGENT_TASKS = 3;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const MAX_WAITING_AGE_MS = 60 * 60 * 1000; // 1 hour — tasks waiting longer than this are failed

export interface TaskOrchestratorDeps {
  db: Database.Database;
  handleRunStart: (client: any, message: any, db: any, options: any, clients: any) => Promise<void>;
  getClients: () => Map<string, any>;
  serverPort: number | null;
  notificationService?: {
    postItem: (item: {
      triggerId?: string;
      taskId?: string;
      sessionId?: string;
      projectId?: string;
      source: NotificationSource;
      title: string;
      summary?: string;
      status: 'running' | 'completed' | 'failed';
      error?: string;
      completedAt?: number;
    }) => { id: string };
    updateItemStatus: (id: string, status: 'running' | 'completed' | 'failed', extra?: {
      summary?: string;
      error?: string;
    }) => void;
    findByTaskId: (taskId: string) => { id: string; title: string; source: string } | undefined;
  };
  /** Called when a task transitions status — used to broadcast claudia_task_update */
  onTaskStatusChange?: (task: OrchestratorTask, extra?: { responseText?: string; toolCount?: number }) => void;
  /** Called when a running task emits streamed text */
  onTaskDelta?: (taskId: string, content: string) => void;
}

export function createTaskOrchestrator(deps: TaskOrchestratorDeps): TaskOrchestrator {
  const repo = new TaskRepository(deps.db);
  const waiters = new Map<string, Set<(result: TaskResult) => void>>();
  const feedOverrides = new Map<string, { triggerId?: string; source: NotificationSource; title: string }>();
  let interval: NodeJS.Timeout | null = null;

  function getFeedSource(task: OrchestratorTask): NotificationSource {
    const override = feedOverrides.get(task.id);
    if (override) return override.source;
    if (task.parentTaskId) return 'delegation';
    if (task.scheduleType) return 'scheduled';
    return 'manual';
  }

  function getFeedTitle(task: OrchestratorTask): string {
    const override = feedOverrides.get(task.id);
    if (override) return override.title;
    const snippet = task.task.trim().replace(/\s+/g, ' ').slice(0, 80);
    return snippet ? `Agent Task: ${snippet}` : 'Agent Task';
  }

  function syncFeedStatus(
    task: OrchestratorTask,
    status: 'completed' | 'failed' | 'cancelled',
    extra?: { resultSummary?: string; errorSummary?: string },
  ): void {
    if (!deps.notificationService) return;
    const mappedStatus = status === 'completed' ? 'completed' : 'failed';
    const summary = extra?.resultSummary ?? task.resultSummary ?? undefined;
    const error = extra?.errorSummary ?? task.errorSummary ?? undefined;
    const existing = deps.notificationService.findByTaskId(task.id);

    if (existing) {
      deps.notificationService.updateItemStatus(existing.id, mappedStatus, { summary, error });
      return;
    }

    deps.notificationService.postItem({
      triggerId: feedOverrides.get(task.id)?.triggerId,
      taskId: task.id,
      sessionId: task.sessionId ?? undefined,
      projectId: task.projectId ?? undefined,
      source: getFeedSource(task),
      title: getFeedTitle(task),
      summary,
      status: mappedStatus,
      error,
      completedAt: Date.now(),
    });
  }

  function resolveWaiters(task: OrchestratorTask): void {
    const taskWaiters = waiters.get(task.id);
    if (!taskWaiters) return;
    const result: TaskResult = {
      taskId: task.id,
      status: task.status,
      summary: task.resultSummary,
      error: task.errorSummary,
    };
    for (const resolve of taskWaiters) {
      resolve(result);
    }
    waiters.delete(task.id);
  }

  function settleTask(taskId: string, status: 'completed' | 'failed' | 'cancelled', extra?: {
    resultSummary?: string;
    errorSummary?: string;
    responseText?: string;
    toolCount?: number;
  }): void {
    repo.updateStatus(taskId, status, {
      completedAt: Date.now(),
      resultSummary: extra?.resultSummary,
      errorSummary: extra?.errorSummary,
      responseText: extra?.responseText,
      toolCount: extra?.toolCount,
    });
    const task = repo.findById(taskId);
    if (task) {
      syncFeedStatus(task, status, extra);
      feedOverrides.delete(task.id);
      resolveWaiters(task);
      deps.onTaskStatusChange?.(task, {
        responseText: extra?.responseText,
        toolCount: extra?.toolCount,
      });
    }
  }

  function executeAgentTask(task: OrchestratorTask): void {
    const now = Date.now();
    let sessionId: string;

    // If task has a branch with an existing session, try to reuse it
    if (task.branchId) {
      const branch = deps.db.prepare(
        'SELECT active_session_id FROM claudia_branches WHERE id = ?'
      ).get(task.branchId) as { active_session_id: string | null } | undefined;
      const existingSession = branch?.active_session_id
        ? deps.db.prepare('SELECT 1 FROM sessions WHERE id = ?').get(branch.active_session_id)
        : null;
      if (branch?.active_session_id && existingSession) {
        sessionId = branch.active_session_id;
      } else {
        // Branch exists but no session — create new
        sessionId = uuidv4();
        deps.db.prepare(`
          INSERT INTO sessions (id, project_id, name, type, parent_session_id, created_at, updated_at)
          VALUES (?, ?, ?, 'agent', NULL, ?, ?)
        `).run(sessionId, task.projectId, `Agent Task: ${task.task.slice(0, 50)}`, now, now);
        deps.db.prepare(
          'UPDATE claudia_branches SET active_session_id = ?, updated_at = ? WHERE id = ?'
        ).run(sessionId, now, task.branchId);
      }
    } else {
      // No branch — create new session as before
      sessionId = uuidv4();
      deps.db.prepare(`
        INSERT INTO sessions (id, project_id, name, type, parent_session_id, created_at, updated_at)
        VALUES (?, ?, ?, 'agent', NULL, ?, ?)
      `).run(sessionId, task.projectId, `Agent Task: ${task.task.slice(0, 50)}`, now, now);
    }

    repo.updateStatus(task.id, 'running', { startedAt: now, sessionId });

    // Notify clients that the task is now running (with sessionId)
    const runningTask = repo.findById(task.id);
    if (runningTask) deps.onTaskStatusChange?.(runningTask);

    if (deps.notificationService) {
      const existing = deps.notificationService.findByTaskId(task.id);
      if (!existing) {
        deps.notificationService.postItem({
          triggerId: feedOverrides.get(task.id)?.triggerId,
          taskId: task.id,
          sessionId,
          projectId: task.projectId ?? undefined,
          source: getFeedSource(task),
          title: getFeedTitle(task),
          summary: task.task,
          status: 'running',
        });
      }
    }

    const clientId = `orchestrator-${task.id}`;
    const clients = deps.getClients();
    let settled = false;

    function cleanupVirtualClient() {
      if (settled) return;
      settled = true;
      clearTimeout(safetyTimer);
      clients.delete(clientId);
    }

    // Safety timeout: fail the task if it hangs for 30 minutes
    const VIRTUAL_CLIENT_TIMEOUT_MS = 30 * 60 * 1000;
    const safetyTimer = setTimeout(() => {
      if (!settled) {
        console.warn(`[TaskOrchestrator] Virtual client timeout for task ${task.id}`);
        cleanupVirtualClient();
        settleTask(task.id, 'failed', { errorSummary: 'Task timed out (30 minutes)' });
      }
    }, VIRTUAL_CLIENT_TIMEOUT_MS);

    // Build a virtual client that captures run completion + streaming content
    let fullContent = '';
    let toolCount = 0;

    const virtualWs = {
      readyState: 1,
      send: (data: string) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'delta') {
            const text = msg.content || '';
            fullContent += text;
            deps.onTaskDelta?.(task.id, text);
          } else if (msg.type === 'tool_use') {
            toolCount++;
          } else if (msg.type === 'run_completed') {
            cleanupVirtualClient();
            // Strip <think> tags from summary before persisting
            const stripped = fullContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
            const summary = stripped.slice(0, 200) || 'Task completed';
            settleTask(task.id, 'completed', {
              resultSummary: summary,
              responseText: fullContent,
              toolCount,
            });
          } else if (msg.type === 'run_failed') {
            cleanupVirtualClient();
            const errorMsg = msg.error || 'Task failed';
            // Retry logic
            if (task.retryCount < task.maxRetries) {
              repo.incrementRetry(task.id);
              repo.updateStatus(task.id, 'queued', { errorSummary: `Retry ${task.retryCount + 1}: ${errorMsg}` });
            } else {
              settleTask(task.id, 'failed', { errorSummary: errorMsg });
            }
          }
        } catch { /* ignore parse errors */ }
      },
    };
    const virtualClient = {
      id: clientId,
      ws: virtualWs,
      isAlive: true,
      isLocal: true,
      authenticated: true,
    };

    // Register virtual client so handleRunStart can find it
    clients.set(clientId, virtualClient);

    // Fire-and-forget: handleRunStart runs the provider asynchronously,
    // completion is detected via virtualWs.send() callback above.
    // Pass contextTemplate via _contextTemplate so run-handler uses the right template.
    deps.handleRunStart(
      virtualClient,
      {
        type: 'run_start',
        clientRequestId: uuidv4(),
        sessionId,
        input: task.task,
        providerId: task.providerId,
        _contextTemplate: task.contextTemplate || 'agent',
      },
      deps.db,
      {},
      clients,
    ).catch((err: any) => {
      cleanupVirtualClient();
      settleTask(task.id, 'failed', { errorSummary: err.message || 'Failed to start task' });
    });
  }

  const orchestrator: TaskOrchestrator = {
    async spawnTask(parentId, config) {
      const id = uuidv4();
      const rootId = parentId
        ? (repo.findById(parentId)?.rootTaskId ?? parentId)
        : id;

      const hasUnmetDeps = config.dependsOn && config.dependsOn.length > 0;

      // Circular dependency detection
      if (hasUnmetDeps) {
        const visited = new Set<string>();
        const stack = [...config.dependsOn!];
        while (stack.length > 0) {
          const depId = stack.pop()!;
          if (depId === id) {
            throw new Error(`Circular dependency detected: task ${id} depends on itself (directly or transitively)`);
          }
          if (visited.has(depId)) continue;
          visited.add(depId);
          const dep = repo.findById(depId);
          if (dep?.dependsOn) {
            stack.push(...dep.dependsOn);
          }
        }
      }

      const status: TaskStatus = hasUnmetDeps ? 'waiting' : 'queued';

      repo.create({
        parentTaskId: parentId,
        rootTaskId: rootId === id ? null : rootId,
        projectId: config.projectId ?? null,
        sessionId: null,
        branchId: config.branchId ?? null,
        branchAction: config.branchAction,
        contextReset: config.contextReset,
        kind: 'agent',
        contextTemplate: config.contextTemplate || 'agent',
        status,
        task: config.task,
        externalId: null,
        initiator: config.initiator ?? 'system',
        dependsOn: config.dependsOn,
        providerId: config.providerId,
        maxRetries: 0,
        scheduleType: config.schedule?.type,
        scheduleConfig: config.schedule ? JSON.stringify(config.schedule) : undefined,
        id,
      });

      if (config.feed) {
        feedOverrides.set(id, config.feed);
      }

      // Let tick() handle execution — avoids race between creation and immediate execution
      return id;
    },

    async steerTask(taskId, instruction) {
      const task = repo.findById(taskId);
      if (!task || task.status !== 'running' || !task.sessionId) {
        throw new Error(`Cannot steer task ${taskId}: not running or no session`);
      }
      // Phase 2: steerTask is not yet implemented (requires injecting into a running provider session)
      throw new Error('steerTask is not yet implemented in Phase 2');
    },

    async killTask(taskId) {
      const task = repo.findById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        return; // Already settled
      }
      settleTask(taskId, 'cancelled', { errorSummary: 'Killed by user or parent agent' });
    },

    async getTaskResult(taskId) {
      const task = repo.findById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);

      // Distinguish in-progress from settled
      if (task.status === 'queued' || task.status === 'waiting' || task.status === 'running') {
        return {
          taskId: task.id,
          status: task.status,
          summary: `Task is still ${task.status} — use waitForTask() or get_task_result(wait=true) to block until completion`,
        };
      }

      return {
        taskId: task.id,
        status: task.status,
        summary: task.resultSummary,
        error: task.errorSummary,
      };
    },

    async waitForTask(taskId, timeoutMs = DEFAULT_WAIT_TIMEOUT_MS) {
      const task = repo.findById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);

      // Already settled
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        return {
          taskId: task.id,
          status: task.status,
          summary: task.resultSummary,
          error: task.errorSummary,
        };
      }

      // Wait for settlement
      return new Promise<TaskResult>((resolve) => {
        if (!waiters.has(taskId)) waiters.set(taskId, new Set());
        const waiterSet = waiters.get(taskId)!;
        let settled = false;

        const timeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          waiterSet.delete(resolveWaiter);
          if (waiterSet.size === 0) waiters.delete(taskId);
          resolve({
            taskId,
            status: 'failed',
            error: `Timeout after ${timeoutMs}ms`,
          });
        }, timeoutMs);

        const resolveWaiter = (result: TaskResult) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          resolve(result);
        };

        waiterSet.add(resolveWaiter);
      });
    },

    getTask(taskId) {
      return repo.findById(taskId);
    },

    listTasks(parentId) {
      return repo.findByParent(parentId ?? null);
    },

    async syncExternalTask(ext) {
      const existing = repo.findByExternalId(ext.kind, ext.externalId);
      if (existing) {
        repo.updateStatus(existing.id, ext.status, {
          startedAt: ext.startedAt,
          completedAt: ext.completedAt,
          resultSummary: ext.resultSummary,
          errorSummary: ext.errorSummary,
          sessionId: ext.sessionId ?? undefined,
        });
        if (ext.status === 'completed' || ext.status === 'failed' || ext.status === 'cancelled') {
          const updated = repo.findById(existing.id);
          if (updated) resolveWaiters(updated);
        }
      } else {
        repo.create({
          parentTaskId: ext.parentTaskId ?? null,
          rootTaskId: ext.rootTaskId ?? null,
          projectId: ext.projectId,
          sessionId: ext.sessionId ?? null,
          branchId: null,
          kind: ext.kind,
          contextTemplate: 'coding',
          status: ext.status,
          task: ext.task,
          externalId: ext.externalId,
          initiator: 'system',
          maxRetries: 0,
          startedAt: ext.startedAt,
          completedAt: ext.completedAt,
          resultSummary: ext.resultSummary,
          errorSummary: ext.errorSummary,
        });
      }
    },

    async tick() {
      const now = Date.now();

      // 1. Promote waiting → queued (dependency resolution)
      const waitingTasks = repo.findByStatus('waiting').filter(t => t.kind === 'agent');
      for (const task of waitingTasks) {
        // Timeout stale waiting tasks
        if (now - task.createdAt > MAX_WAITING_AGE_MS) {
          settleTask(task.id, 'failed', { errorSummary: `Waiting timeout: dependencies not resolved within ${MAX_WAITING_AGE_MS / 1000}s` });
          continue;
        }

        if (!task.dependsOn || task.dependsOn.length === 0) {
          repo.updateStatus(task.id, 'queued');
          continue;
        }
        const allDepsCompleted = task.dependsOn.every(depId => {
          const dep = repo.findById(depId);
          return dep?.status === 'completed';
        });
        const anyDepFailed = task.dependsOn.some(depId => {
          const dep = repo.findById(depId);
          return dep?.status === 'failed' || dep?.status === 'cancelled';
        });
        if (anyDepFailed) {
          settleTask(task.id, 'failed', { errorSummary: 'Dependency failed or was cancelled' });
        } else if (allDepsCompleted) {
          repo.updateStatus(task.id, 'queued');
        }
      }

      // 2. Execute queued agent tasks (respecting concurrency limit)
      const runningCount = repo.findByStatus('running').filter(t => t.kind === 'agent').length;
      const available = MAX_CONCURRENT_AGENT_TASKS - runningCount;
      if (available > 0) {
        const queuedTasks = repo.findByStatus('queued').filter(t => t.kind === 'agent');
        for (const task of queuedTasks.slice(0, available)) {
          executeAgentTask(task);
        }
      }
    },

    start(intervalMs = 10000) {
      if (interval) return;
      interval = setInterval(() => orchestrator.tick().catch(err => {
        console.error('[TaskOrchestrator] tick error:', err);
      }), intervalMs);
      console.log(`[TaskOrchestrator] started (interval=${intervalMs}ms)`);
    },

    stop() {
      if (interval) {
        clearInterval(interval);
        interval = null;
        console.log('[TaskOrchestrator] stopped');
      }
    },
  };

  return orchestrator;
}
