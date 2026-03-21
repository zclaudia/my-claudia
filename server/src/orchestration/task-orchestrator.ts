/**
 * TaskOrchestrator — unified task orchestration layer.
 *
 * Phase 2: Only owns kind='agent' tasks.
 * External tasks (supervision/workflow/scheduled) are mirrored via syncExternalTask().
 */

import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type {
  TaskOrchestrator,
  SpawnTaskConfig,
  TaskResult,
  OrchestratorTask,
  ExternalTaskSync,
} from './types.js';
import { TaskRepository } from './repository.js';
import { createContextEngine } from '../context/engine.js';
import type { ContextTemplate } from '../context/types.js';

const MAX_CONCURRENT_AGENT_TASKS = 3;
const DEFAULT_WAIT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface TaskOrchestratorDeps {
  db: Database.Database;
  handleRunStart: (client: any, message: any, db: any, options: any, clients: any) => Promise<void>;
  getClients: () => Map<string, any>;
  serverPort: number | null;
}

export function createTaskOrchestrator(deps: TaskOrchestratorDeps): TaskOrchestrator {
  const repo = new TaskRepository(deps.db);
  const waiters = new Map<string, Set<(result: TaskResult) => void>>();
  let interval: NodeJS.Timeout | null = null;

  function resolveWaiters(task: OrchestratorTask): void {
    const taskWaiters = waiters.get(task.id);
    if (!taskWaiters) return;
    const result: TaskResult = {
      taskId: task.id,
      status: task.status === 'completed' ? 'completed' : 'failed',
      summary: task.resultSummary,
      error: task.errorSummary,
    };
    for (const resolve of taskWaiters) {
      resolve(result);
    }
    waiters.delete(task.id);
  }

  function settleTask(taskId: string, status: 'completed' | 'failed', extra?: {
    resultSummary?: string;
    errorSummary?: string;
  }): void {
    repo.updateStatus(taskId, status, {
      completedAt: Date.now(),
      ...extra,
    });
    const task = repo.findById(taskId);
    if (task) resolveWaiters(task);
  }

  async function executeAgentTask(task: OrchestratorTask): Promise<void> {
    // Create a background session for this task
    const sessionId = uuidv4();
    const now = Date.now();
    deps.db.prepare(`
      INSERT INTO sessions (id, project_id, name, type, parent_session_id, created_at, updated_at)
      VALUES (?, ?, ?, 'background', NULL, ?, ?)
    `).run(sessionId, task.projectId, `Agent Task: ${task.task.slice(0, 50)}`, now, now);

    repo.updateStatus(task.id, 'running', { startedAt: now, sessionId });

    // Build a virtual client that captures run completion
    const virtualWs = {
      readyState: 1, // WebSocket.OPEN
      send: (data: string) => {
        try {
          const msg = JSON.parse(data);
          if (msg.type === 'run_completed') {
            settleTask(task.id, 'completed', { resultSummary: 'Task completed successfully' });
          } else if (msg.type === 'run_failed') {
            settleTask(task.id, 'failed', { errorSummary: msg.error || 'Task failed' });
          }
        } catch { /* ignore parse errors */ }
      },
    };
    const virtualClient = {
      id: `orchestrator-${task.id}`,
      ws: virtualWs,
      isAlive: true,
      isLocal: true,
      authenticated: true,
    };

    const contextEngine = createContextEngine();
    const template = (task.contextTemplate || 'agent') as ContextTemplate;
    const systemPrompt = contextEngine.assemble(template, {
      sessionId,
      projectId: task.projectId ?? undefined,
    });

    try {
      await deps.handleRunStart(
        virtualClient,
        {
          type: 'run_start',
          clientRequestId: uuidv4(),
          sessionId,
          input: task.task,
          providerId: task.providerId,
          systemContext: systemPrompt || undefined,
        },
        deps.db,
        {},
        deps.getClients(),
      );
    } catch (err: any) {
      settleTask(task.id, 'failed', { errorSummary: err.message || 'Failed to start task' });
    }
  }

  const orchestrator: TaskOrchestrator = {
    async spawnTask(parentId, config) {
      const id = uuidv4();
      const rootId = parentId
        ? (repo.findById(parentId)?.rootTaskId ?? parentId)
        : id;

      const hasUnmetDeps = config.dependsOn && config.dependsOn.length > 0;
      const status = hasUnmetDeps ? 'waiting' : 'queued';

      repo.create({
        parentTaskId: parentId,
        rootTaskId: rootId === id ? null : rootId,
        projectId: config.projectId ?? null,
        sessionId: null,
        kind: 'agent',
        contextTemplate: config.contextTemplate || 'agent',
        status,
        task: config.task,
        externalId: null,
        dependsOn: config.dependsOn,
        providerId: config.providerId,
        maxRetries: 0,
        scheduleType: config.schedule?.type,
        scheduleConfig: config.schedule ? JSON.stringify(config.schedule) : undefined,
        id,
      });

      // If no deps and no schedule, try to execute immediately
      if (status === 'queued' && !config.schedule) {
        const runningCount = repo.findByStatus('running')
          .filter(t => t.kind === 'agent').length;
        if (runningCount < MAX_CONCURRENT_AGENT_TASKS) {
          const task = repo.findById(id)!;
          await executeAgentTask(task);
        }
      }

      return id;
    },

    async steerTask(taskId, instruction) {
      const task = repo.findById(taskId);
      if (!task || task.status !== 'running' || !task.sessionId) {
        throw new Error(`Cannot steer task ${taskId}: not running or no session`);
      }
      // TODO: inject instruction into the running session
      // For Phase 2, this is a placeholder
      console.log(`[TaskOrchestrator] steer task=${taskId} instruction=${instruction.slice(0, 50)}`);
    },

    async killTask(taskId) {
      const task = repo.findById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
        return; // Already settled
      }
      settleTask(taskId, 'cancelled' as any, { errorSummary: 'Killed by user or parent agent' });
      // Cancel status is not in TaskResult, so we use 'failed' for waiters
    },

    async getTaskResult(taskId) {
      const task = repo.findById(taskId);
      if (!task) throw new Error(`Task not found: ${taskId}`);
      return {
        taskId: task.id,
        status: task.status === 'completed' ? 'completed' as const : 'failed' as const,
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
          status: task.status === 'completed' ? 'completed' as const : 'failed' as const,
          summary: task.resultSummary,
          error: task.errorSummary,
        };
      }

      // Wait for settlement
      return new Promise<TaskResult>((resolve) => {
        if (!waiters.has(taskId)) waiters.set(taskId, new Set());
        const waiterSet = waiters.get(taskId)!;

        const timeout = setTimeout(() => {
          waiterSet.delete(resolveWaiter);
          if (waiterSet.size === 0) waiters.delete(taskId);
          resolve({
            taskId,
            status: 'failed',
            error: `Timeout after ${timeoutMs}ms`,
          });
        }, timeoutMs);

        const resolveWaiter = (result: TaskResult) => {
          clearTimeout(timeout);
          resolve(result);
        };

        waiterSet.add(resolveWaiter);
      });
    },

    listTasks(parentId) {
      return repo.findByParent(parentId ?? null);
    },

    async syncExternalTask(ext) {
      const existing = repo.findByExternalId(ext.kind, ext.externalId);
      if (existing) {
        // Update status
        repo.updateStatus(existing.id, ext.status, {
          startedAt: ext.startedAt,
          completedAt: ext.completedAt,
          resultSummary: ext.resultSummary,
          errorSummary: ext.errorSummary,
          sessionId: ext.sessionId ?? undefined,
        });
        if (ext.status === 'completed' || ext.status === 'failed') {
          const updated = repo.findById(existing.id);
          if (updated) resolveWaiters(updated);
        }
      } else {
        repo.create({
          parentTaskId: ext.parentTaskId ?? null,
          rootTaskId: ext.rootTaskId ?? null,
          projectId: ext.projectId,
          sessionId: ext.sessionId ?? null,
          kind: ext.kind,
          contextTemplate: 'coding',
          status: ext.status,
          task: ext.task,
          externalId: ext.externalId,
          maxRetries: 0,
          startedAt: ext.startedAt,
          completedAt: ext.completedAt,
          resultSummary: ext.resultSummary,
          errorSummary: ext.errorSummary,
        });
      }
    },

    async tick() {
      // 1. Promote waiting → queued (dependency resolution)
      const waitingTasks = repo.findByStatus('waiting').filter(t => t.kind === 'agent');
      for (const task of waitingTasks) {
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
          settleTask(task.id, 'failed', { errorSummary: 'Dependency failed' });
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
          await executeAgentTask(task);
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
