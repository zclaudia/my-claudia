/**
 * Scheduled Task Service
 *
 * General-purpose scheduled task system. Supports cron / interval / once schedules
 * with multiple action types: prompt, command, shell, webhook, plugin_event.
 *
 * tick() is called every 10s by setInterval in server.ts.
 */

import type { Database } from 'better-sqlite3';
import type {
  ScheduledTask,
  ServerMessage,
  PromptActionConfig,
  ShellActionConfig,
  WebhookActionConfig,
  PluginEventActionConfig,
  Session,
} from '@my-claudia/shared';
import { ScheduledTaskRepository } from '../repositories/scheduled-task.js';
import { TaskRunRepository } from '../repositories/task-run.js';
import { ProjectRepository } from '../repositories/project.js';
import { SessionRepository } from '../repositories/session.js';
import { computeNextCronRun } from '../utils/cron.js';
import { createVirtualClient, handleRunStart } from '../server.js';
import { pluginEvents } from '../events/index.js';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

const PROMPT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export class ScheduledTaskService {
  private repo: ScheduledTaskRepository;
  private taskRunRepo: TaskRunRepository;
  private projectRepo: ProjectRepository;
  private sessionRepo: SessionRepository;
  private activeRuns = new Map<string, boolean>();
  private lastPruneAt = 0;
  private static PRUNE_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  constructor(
    private db: Database,
    private broadcastFn: (message: ServerMessage) => void,
  ) {
    this.repo = new ScheduledTaskRepository(db);
    this.taskRunRepo = new TaskRunRepository(db);
    this.projectRepo = new ProjectRepository(db);
    this.sessionRepo = new SessionRepository(db);
  }

  getRepo(): ScheduledTaskRepository {
    return this.repo;
  }

  getTaskRunRepo(): TaskRunRepository {
    return this.taskRunRepo;
  }

  // ── tick() ──────────────────────────────────────────────────────

  async tick(): Promise<void> {
    try {
      const now = Date.now();
      const dueTasks = this.repo.findDueTasks(now);

      for (const task of dueTasks) {
        if (this.activeRuns.has(task.id)) continue;
        this.executeTask(task).catch((err) => {
          console.error(`[ScheduledTasks] Error executing task ${task.id}:`, err);
        });
      }

      // Periodically prune old run history
      if (now - this.lastPruneAt > ScheduledTaskService.PRUNE_INTERVAL_MS) {
        this.lastPruneAt = now;
        try {
          const pruned = this.taskRunRepo.pruneOldRuns(7);
          if (pruned > 0) console.log(`[ScheduledTasks] Pruned ${pruned} old task runs`);
        } catch (err) {
          console.error('[ScheduledTasks] Prune error:', err);
        }
      }
    } catch (err) {
      console.error('[ScheduledTasks] tick error:', err);
    }
  }

  // ── Task Execution ──────────────────────────────────────────────

  async executeTask(task: ScheduledTask): Promise<void> {
    this.activeRuns.set(task.id, true);
    const startedAt = Date.now();
    this.repo.update(task.id, { status: 'running', lastRunAt: startedAt });
    this.broadcastUpdate(task.id);

    // Record run start
    const run = this.taskRunRepo.create({
      taskId: task.id,
      taskSource: 'user',
      status: 'running',
      startedAt,
    });

    try {
      let result: string;

      switch (task.actionType) {
        case 'prompt':
          result = await this.executePrompt(task);
          break;
        case 'command':
          result = await this.executeCommand(task);
          break;
        case 'shell':
          result = await this.executeShell(task);
          break;
        case 'webhook':
          result = await this.executeWebhook(task);
          break;
        case 'plugin_event':
          result = await this.executePluginEvent(task);
          break;
        default:
          result = `Unknown action type: ${task.actionType}`;
      }

      const completedAt = Date.now();
      const nextRun = this.computeNextRun(task);
      this.repo.update(task.id, {
        status: 'idle',
        lastRunResult: result,
        lastError: undefined,
        runCount: task.runCount + 1,
        nextRun: nextRun ?? undefined,
        enabled: task.scheduleType === 'once' ? false : task.enabled,
      });

      // Record run completion
      this.taskRunRepo.update(run.id, {
        status: 'completed',
        completedAt,
        durationMs: completedAt - startedAt,
        result: result.slice(0, 2000),
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const completedAt = Date.now();
      const nextRun = this.computeNextRun(task);
      this.repo.update(task.id, {
        status: 'error',
        lastError: errorMsg,
        runCount: task.runCount + 1,
        nextRun: nextRun ?? undefined,
      });

      // Record run failure
      this.taskRunRepo.update(run.id, {
        status: 'failed',
        completedAt,
        durationMs: completedAt - startedAt,
        error: errorMsg.slice(0, 2000),
      });
    } finally {
      this.activeRuns.delete(task.id);
      this.broadcastUpdate(task.id);
    }
  }

  // ── Action Executors ────────────────────────────────────────────

  private async executePrompt(task: ScheduledTask): Promise<string> {
    const config = task.actionConfig as PromptActionConfig;

    let providerId: string | undefined;
    let workingDirectory: string | undefined;

    if (task.projectId) {
      const project = this.projectRepo.findById(task.projectId);
      if (!project) throw new Error(`Project not found: ${task.projectId}`);
      providerId = config.providerId ?? project.providerId;
      workingDirectory = project.rootPath;
    } else {
      providerId = config.providerId;
    }

    if (!providerId) throw new Error('No provider configured for prompt action');

    const session = this.sessionRepo.create({
      projectId: task.projectId ?? '__global__',
      name: config.sessionName ?? `Scheduled: ${task.name}`,
      type: 'background',
      projectRole: 'scheduled',
      workingDirectory,
      providerId,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.activeRuns.delete(task.id);
        reject(new Error('Prompt execution timed out after 10 minutes'));
      }, PROMPT_TIMEOUT_MS);

      const clientId = `scheduled_${task.id}_${Date.now()}`;
      const virtualClient = createVirtualClient(clientId, {
        send: (msg: ServerMessage) => {
          if (msg.type === 'run_completed') {
            clearTimeout(timeout);
            resolve(`Prompt completed in session ${session.id}`);
          } else if (msg.type === 'run_failed') {
            clearTimeout(timeout);
            reject(new Error((msg as any).error ?? 'Run failed'));
          }
        },
      });

      handleRunStart(
        virtualClient,
        {
          type: 'run_start',
          clientRequestId: clientId,
          sessionId: session.id,
          input: config.prompt,
          workingDirectory,
          providerId,
        },
        this.db as any,
      );
    });
  }

  private async executeCommand(task: ScheduledTask): Promise<string> {
    const config = task.actionConfig as { command: string };
    const { commandRegistry } = await import('../commands/registry.js');
    const result = await commandRegistry.execute(config.command, []);
    return typeof result === 'string' ? result : JSON.stringify(result);
  }

  private async executeShell(task: ScheduledTask): Promise<string> {
    const config = task.actionConfig as ShellActionConfig;
    let cwd = config.cwd;

    if (!cwd && task.projectId) {
      const project = this.projectRepo.findById(task.projectId);
      cwd = project?.rootPath;
    }

    const timeout = config.timeoutMs ?? 60000;
    const { stdout, stderr } = await execFileAsync(
      '/bin/sh',
      ['-c', config.command],
      { cwd: cwd ?? process.cwd(), timeout, maxBuffer: 1024 * 1024 },
    );

    return stderr ? `stdout: ${stdout}\nstderr: ${stderr}` : stdout;
  }

  private async executeWebhook(task: ScheduledTask): Promise<string> {
    const config = task.actionConfig as WebhookActionConfig;
    const method = config.method ?? 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
    };

    const response = await fetch(config.url, {
      method,
      headers,
      body: method !== 'GET' ? config.body : undefined,
    });

    const text = await response.text();
    return `HTTP ${response.status}: ${text.slice(0, 500)}`;
  }

  private async executePluginEvent(task: ScheduledTask): Promise<string> {
    const config = task.actionConfig as PluginEventActionConfig;
    await pluginEvents.emit(config.event, config.data ?? {}, 'scheduled-tasks');
    return `Event emitted: ${config.event}`;
  }

  // ── Schedule Computation ────────────────────────────────────────

  computeNextRun(task: Partial<ScheduledTask>, fromDate?: number): number | null {
    const now = fromDate ?? Date.now();

    switch (task.scheduleType) {
      case 'cron':
        return task.scheduleCron ? computeNextCronRun(task.scheduleCron, now) : null;
      case 'interval':
        return task.scheduleIntervalMinutes
          ? now + task.scheduleIntervalMinutes * 60 * 1000
          : null;
      case 'once':
        return null;
      default:
        return null;
    }
  }

  computeInitialNextRun(task: Partial<ScheduledTask>): number | null {
    switch (task.scheduleType) {
      case 'cron':
        return task.scheduleCron ? computeNextCronRun(task.scheduleCron) : null;
      case 'interval':
        return task.scheduleIntervalMinutes
          ? Date.now() + task.scheduleIntervalMinutes * 60 * 1000
          : null;
      case 'once':
        return task.scheduleOnceAt ?? null;
      default:
        return null;
    }
  }

  // ── Manual Trigger ──────────────────────────────────────────────

  async triggerNow(taskId: string): Promise<void> {
    const task = this.repo.findById(taskId);
    if (!task) throw new Error(`Scheduled task not found: ${taskId}`);
    await this.executeTask(task);
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private broadcastUpdate(taskId: string): void {
    const task = this.repo.findById(taskId);
    if (task) {
      this.broadcastFn({
        type: 'scheduled_task_update',
        projectId: task.projectId,
        task,
      } as any);
    }
  }

  broadcastDelete(projectId: string | undefined, taskId: string): void {
    this.broadcastFn({
      type: 'scheduled_task_deleted',
      projectId,
      taskId,
    } as any);
  }
}
