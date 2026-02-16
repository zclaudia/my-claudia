import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type {
  Supervision,
  SupervisionStatus,
  SupervisionSubtask,
  SupervisionLog,
  SupervisionLogEvent,
  SupervisionUpdateMessage,
  ServerMessage
} from '@my-claudia/shared';
import { createVirtualClient, handleRunStart, activeRuns, sendMessage } from '../server.js';
import type { ConnectedClient } from '../server.js';

const GOAL_COMPLETE_MARKER = '[GOAL_COMPLETE]';
const SUBTASK_COMPLETE_REGEX = /\[SUBTASK_COMPLETE:(\d+)\]/g;

interface SupervisionRow {
  id: string;
  session_id: string;
  goal: string;
  subtasks: string | null;
  status: string;
  max_iterations: number;
  current_iteration: number;
  cooldown_seconds: number;
  last_run_id: string | null;
  error_message: string | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

interface SupervisionLogRow {
  id: string;
  supervision_id: string;
  iteration: number | null;
  event: string;
  detail: string | null;
  created_at: number;
}

export class SupervisorService {
  private pollInterval: NodeJS.Timeout | null = null;
  private virtualClients = new Map<string, ConnectedClient>();
  private pendingCooldowns = new Map<string, NodeJS.Timeout>();
  private broadcastFn: ((msg: ServerMessage) => void) | null = null;
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  setBroadcast(fn: (msg: ServerMessage) => void): void {
    this.broadcastFn = fn;
  }

  start(intervalMs = 3000): void {
    if (this.pollInterval) return;
    this.pollInterval = setInterval(() => this.tick(), intervalMs);
    console.log('[Supervisor] Started polling');
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.pendingCooldowns.forEach(timer => clearTimeout(timer));
    this.pendingCooldowns.clear();
    console.log('[Supervisor] Stopped');
  }

  // ========================================
  // Core polling loop
  // ========================================

  private tick(): void {
    const rows = this.db.prepare(
      `SELECT * FROM supervisions WHERE status = 'active'`
    ).all() as SupervisionRow[];

    for (const row of rows) {
      try {
        this.processSingle(row);
      } catch (err) {
        console.error(`[Supervisor] Error processing ${row.id}:`, err);
        this.updateStatus(row.id, 'failed',
          err instanceof Error ? err.message : 'Unknown error');
      }
    }
  }

  private processSingle(row: SupervisionRow): void {
    // Skip if in cooldown
    if (this.pendingCooldowns.has(row.id)) return;

    // Skip if session has an active run
    if (this.isSessionRunning(row.session_id)) return;

    if (row.last_run_id) {
      // A previous run has completed — evaluate progress
      const sup = this.rowToSupervision(row);
      const { goalComplete, completedSubtaskIds } = this.evaluateProgress(sup);

      // Update subtask statuses if any completed
      if (completedSubtaskIds.length > 0) {
        this.markSubtasksCompleted(row.id, completedSubtaskIds);
      }

      if (goalComplete) {
        this.updateStatus(row.id, 'completed');
        this.appendLog(row.id, 'goal_completed', row.current_iteration);
        return;
      }

      // Check iteration limit → pause (not fail)
      if (row.current_iteration >= row.max_iterations) {
        this.updateStatus(row.id, 'paused', 'Reached maximum iterations');
        this.appendLog(row.id, 'paused', row.current_iteration, { reason: 'iteration_limit' });
        return;
      }

      // Schedule next run after cooldown
      this.scheduleCooldown(row);
    } else {
      // First run — trigger immediately with initial prompt
      const sup = this.rowToSupervision(row);
      const prompt = this.buildInitialPrompt(sup.goal, sup.subtasks);
      this.triggerRun(row, prompt);
    }
  }

  // ========================================
  // Run triggering
  // ========================================

  private triggerRun(row: SupervisionRow, input: string): void {
    const clientId = `supervisor_${row.id}`;
    const runStartTime = Date.now();

    let virtualClient = this.virtualClients.get(clientId);
    if (!virtualClient) {
      virtualClient = createVirtualClient(clientId, {
        send: (msg: ServerMessage) => {
          this.handleRunMessage(row.id, msg, runStartTime);
        }
      });
      this.virtualClients.set(clientId, virtualClient);
    }

    const clientRequestId = `supervision_${row.id}_${Date.now()}`;
    const newIteration = row.current_iteration + 1;

    // Update iteration count
    this.db.prepare(`
      UPDATE supervisions SET current_iteration = ?, updated_at = ? WHERE id = ?
    `).run(newIteration, Date.now(), row.id);

    this.appendLog(row.id, 'iteration_started', newIteration);

    // Trigger the run
    handleRunStart(virtualClient, {
      type: 'run_start',
      clientRequestId,
      sessionId: row.session_id,
      input,
    }, this.db);

    this.broadcastUpdate(row.id);
  }

  private handleRunMessage(supervisionId: string, msg: ServerMessage, runStartTime: number): void {
    if (msg.type === 'run_started' && 'runId' in msg) {
      this.db.prepare(
        'UPDATE supervisions SET last_run_id = ?, updated_at = ? WHERE id = ?'
      ).run((msg as any).runId, Date.now(), supervisionId);
    }

    if (msg.type === 'run_completed') {
      const sup = this.getSupervisionRow(supervisionId);
      const iteration = sup?.current_iteration ?? 0;
      const durationMs = Date.now() - runStartTime;
      this.appendLog(supervisionId, 'iteration_completed', iteration, {
        runId: sup?.last_run_id,
        durationMs
      });
      this.broadcastUpdate(supervisionId);
    }

    if (msg.type === 'run_failed') {
      const sup = this.getSupervisionRow(supervisionId);
      const iteration = sup?.current_iteration ?? 0;
      const errorMsg = 'error' in msg ? (msg as any).error : 'Run failed';
      this.appendLog(supervisionId, 'iteration_failed', iteration, {
        runId: sup?.last_run_id,
        error: errorMsg
      });
      this.updateStatus(supervisionId, 'failed', errorMsg);
    }
  }

  private scheduleCooldown(row: SupervisionRow): void {
    if (this.pendingCooldowns.has(row.id)) return;

    const timer = setTimeout(() => {
      this.pendingCooldowns.delete(row.id);
      // Re-read from DB in case status changed
      const current = this.getSupervisionRow(row.id);
      if (!current || current.status !== 'active') return;

      const sup = this.rowToSupervision(current);
      const prompt = this.buildContinuePrompt(sup.goal, current.current_iteration + 1, sup.subtasks);
      this.triggerRun(current, prompt);
    }, row.cooldown_seconds * 1000);

    this.pendingCooldowns.set(row.id, timer);
  }

  // ========================================
  // Progress evaluation
  // ========================================

  private evaluateProgress(sup: Supervision): { goalComplete: boolean; completedSubtaskIds: number[] } {
    // Read recent assistant messages
    const messages = this.db.prepare(`
      SELECT content FROM messages
      WHERE session_id = ? AND role = 'assistant'
      ORDER BY created_at DESC LIMIT 3
    `).all(sup.sessionId) as { content: string }[];

    let goalComplete = false;
    const completedSubtaskIds: number[] = [];

    for (const msg of messages) {
      if (msg.content.includes(GOAL_COMPLETE_MARKER)) {
        goalComplete = true;
      }

      let match;
      SUBTASK_COMPLETE_REGEX.lastIndex = 0;
      while ((match = SUBTASK_COMPLETE_REGEX.exec(msg.content)) !== null) {
        completedSubtaskIds.push(parseInt(match[1], 10));
      }
    }

    // If all subtasks are completed, consider goal complete
    if (sup.subtasks && sup.subtasks.length > 0 && !goalComplete) {
      const allIds = new Set(sup.subtasks.map(s => s.id));
      const alreadyCompleted = new Set(
        sup.subtasks.filter(s => s.status === 'completed').map(s => s.id)
      );
      for (const id of completedSubtaskIds) {
        alreadyCompleted.add(id);
      }
      if (allIds.size > 0 && allIds.size === alreadyCompleted.size) {
        goalComplete = true;
      }
    }

    return { goalComplete, completedSubtaskIds };
  }

  private markSubtasksCompleted(supervisionId: string, subtaskIds: number[]): void {
    const row = this.getSupervisionRow(supervisionId);
    if (!row || !row.subtasks) return;

    const subtasks: SupervisionSubtask[] = JSON.parse(row.subtasks);
    const now = Date.now();
    let changed = false;

    for (const subtask of subtasks) {
      if (subtaskIds.includes(subtask.id) && subtask.status !== 'completed') {
        subtask.status = 'completed';
        subtask.completedAt = now;
        changed = true;
        this.appendLog(supervisionId, 'subtask_completed', row.current_iteration, {
          subtaskId: subtask.id,
          description: subtask.description
        });
      }
    }

    if (changed) {
      this.db.prepare(
        'UPDATE supervisions SET subtasks = ?, updated_at = ? WHERE id = ?'
      ).run(JSON.stringify(subtasks), now, supervisionId);
    }
  }

  // ========================================
  // Prompt construction
  // ========================================

  private buildInitialPrompt(goal: string, subtasks?: SupervisionSubtask[]): string {
    let prompt = `[SUPERVISED SESSION]\nGoal: ${goal}\n\nContinue working based on our previous conversation.\n`;

    if (subtasks && subtasks.length > 0) {
      prompt += '\nSubtasks:\n';
      for (const st of subtasks) {
        prompt += `${st.id}. [ ] ${st.description}\n`;
      }
      prompt += '\nWhen you complete a subtask, include [SUBTASK_COMPLETE:N] (where N is the subtask number) in your response.\n';
    }

    prompt += '\nWhen the goal is fully achieved, include [GOAL_COMPLETE] in your response.\nIf you encounter a blocker, explain what is preventing progress.\n\nPlease begin working now.';
    return prompt;
  }

  private buildContinuePrompt(goal: string, iteration: number, subtasks?: SupervisionSubtask[]): string {
    let prompt = `[SUPERVISION CONTINUE - Iteration ${iteration}]\nThe previous run completed but the goal is not yet met.\n\nGoal: ${goal}\n`;

    if (subtasks && subtasks.length > 0) {
      prompt += '\nSubtask progress:\n';
      for (const st of subtasks) {
        const mark = st.status === 'completed' ? 'x' : ' ';
        prompt += `${st.id}. [${mark}] ${st.description}${st.status === 'completed' ? ' (done)' : ''}\n`;
      }
      prompt += '\nContinue working on the remaining subtasks. Mark completed ones with [SUBTASK_COMPLETE:N].\n';
    }

    prompt += '\nWhen the goal is fully achieved, include [GOAL_COMPLETE] in your response.\nIf blocked, explain what is preventing progress.';
    return prompt;
  }

  // ========================================
  // Logging
  // ========================================

  private appendLog(
    supervisionId: string,
    event: SupervisionLogEvent,
    iteration?: number,
    detail?: Record<string, unknown>
  ): SupervisionLog {
    const id = uuidv4();
    const now = Date.now();

    this.db.prepare(`
      INSERT INTO supervision_logs (id, supervision_id, iteration, event, detail, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(id, supervisionId, iteration ?? null, event, detail ? JSON.stringify(detail) : null, now);

    const log: SupervisionLog = {
      id,
      supervisionId,
      iteration,
      event,
      detail,
      createdAt: now
    };

    // Broadcast with the log entry attached
    this.broadcastUpdate(supervisionId, log);

    return log;
  }

  getLogsBySupervisionId(supervisionId: string): SupervisionLog[] {
    const rows = this.db.prepare(
      'SELECT * FROM supervision_logs WHERE supervision_id = ? ORDER BY created_at ASC'
    ).all(supervisionId) as SupervisionLogRow[];
    return rows.map(row => this.rowToLog(row));
  }

  // ========================================
  // CRUD
  // ========================================

  create(
    sessionId: string,
    goal: string,
    options?: {
      subtasks?: string[];
      maxIterations?: number;
      cooldownSeconds?: number;
    }
  ): Supervision {
    // Enforce one active supervision per session
    const existing = this.db.prepare(
      `SELECT id FROM supervisions WHERE session_id = ? AND status IN ('active', 'paused')`
    ).get(sessionId);
    if (existing) {
      throw new Error('Session already has an active supervision');
    }

    const id = uuidv4();
    const now = Date.now();

    // Build subtasks if provided
    let subtasksJson: string | null = null;
    if (options?.subtasks && options.subtasks.length > 0) {
      const subtasks: SupervisionSubtask[] = options.subtasks.map((desc, idx) => ({
        id: idx + 1,
        description: desc,
        status: 'pending' as const
      }));
      subtasksJson = JSON.stringify(subtasks);
    }

    // Dynamic maxIterations: no subtasks → 5, with subtasks → count * 3
    const defaultMaxIterations = options?.subtasks && options.subtasks.length > 0
      ? options.subtasks.length * 3
      : 5;

    this.db.prepare(`
      INSERT INTO supervisions (id, session_id, goal, subtasks, status, max_iterations, cooldown_seconds, current_iteration, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'active', ?, ?, 0, ?, ?)
    `).run(
      id, sessionId, goal, subtasksJson,
      options?.maxIterations ?? defaultMaxIterations,
      options?.cooldownSeconds ?? 5,
      now, now
    );

    return this.getSupervision(id)!;
  }

  pause(id: string, reason?: string): Supervision {
    this.updateStatus(id, 'paused');
    // Clear any pending cooldown
    const timer = this.pendingCooldowns.get(id);
    if (timer) {
      clearTimeout(timer);
      this.pendingCooldowns.delete(id);
    }
    this.appendLog(id, 'paused', undefined, { reason: reason || 'user' });
    return this.getSupervision(id)!;
  }

  resume(id: string, options?: { maxIterations?: number }): Supervision {
    const row = this.getSupervisionRow(id);
    if (!row || row.status !== 'paused') {
      throw new Error('Supervision is not paused');
    }

    const updates: string[] = ['status = ?', 'updated_at = ?', 'last_run_id = NULL'];
    const params: any[] = ['active', Date.now()];

    if (options?.maxIterations !== undefined) {
      updates.push('max_iterations = ?');
      params.push(options.maxIterations);
    }

    params.push(id);
    this.db.prepare(
      `UPDATE supervisions SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);

    this.appendLog(id, 'resumed');
    this.broadcastUpdate(id);
    return this.getSupervision(id)!;
  }

  cancel(id: string): Supervision {
    this.updateStatus(id, 'cancelled', 'Cancelled by user');
    // Clear cooldown
    const timer = this.pendingCooldowns.get(id);
    if (timer) {
      clearTimeout(timer);
      this.pendingCooldowns.delete(id);
    }
    // Cleanup virtual client
    this.virtualClients.delete(`supervisor_${id}`);
    this.appendLog(id, 'cancelled');
    return this.getSupervision(id)!;
  }

  getSupervision(id: string): Supervision | null {
    const row = this.getSupervisionRow(id);
    return row ? this.rowToSupervision(row) : null;
  }

  getBySessionId(sessionId: string): Supervision | null {
    const row = this.db.prepare(
      `SELECT * FROM supervisions WHERE session_id = ? ORDER BY created_at DESC LIMIT 1`
    ).get(sessionId) as SupervisionRow | undefined;
    return row ? this.rowToSupervision(row) : null;
  }

  getActiveBySessionId(sessionId: string): Supervision | null {
    const row = this.db.prepare(
      `SELECT * FROM supervisions WHERE session_id = ? AND status IN ('active', 'paused') LIMIT 1`
    ).get(sessionId) as SupervisionRow | undefined;
    return row ? this.rowToSupervision(row) : null;
  }

  listAll(): Supervision[] {
    const rows = this.db.prepare(
      'SELECT * FROM supervisions ORDER BY created_at DESC'
    ).all() as SupervisionRow[];
    return rows.map(r => this.rowToSupervision(r));
  }

  update(id: string, data: {
    maxIterations?: number;
    cooldownSeconds?: number;
    goal?: string;
  }): Supervision {
    const updates: string[] = [];
    const params: any[] = [];

    if (data.maxIterations !== undefined) {
      updates.push('max_iterations = ?');
      params.push(data.maxIterations);
    }
    if (data.cooldownSeconds !== undefined) {
      updates.push('cooldown_seconds = ?');
      params.push(data.cooldownSeconds);
    }
    if (data.goal !== undefined) {
      updates.push('goal = ?');
      params.push(data.goal);
    }

    if (updates.length === 0) {
      return this.getSupervision(id)!;
    }

    updates.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);

    this.db.prepare(
      `UPDATE supervisions SET ${updates.join(', ')} WHERE id = ?`
    ).run(...params);

    this.broadcastUpdate(id);
    return this.getSupervision(id)!;
  }

  // ========================================
  // Helpers
  // ========================================

  private isSessionRunning(sessionId: string): boolean {
    for (const [, run] of activeRuns) {
      if (run.sessionId === sessionId) return true;
    }
    return false;
  }

  private getSupervisionRow(id: string): SupervisionRow | undefined {
    return this.db.prepare('SELECT * FROM supervisions WHERE id = ?')
      .get(id) as SupervisionRow | undefined;
  }

  private updateStatus(id: string, status: SupervisionStatus, errorMessage?: string): void {
    const now = Date.now();
    const isTerminal = ['completed', 'failed', 'cancelled'].includes(status);

    this.db.prepare(`
      UPDATE supervisions SET status = ?, error_message = ?, updated_at = ?${isTerminal ? ', completed_at = ?' : ''}
      WHERE id = ?
    `).run(
      ...(isTerminal
        ? [status, errorMessage ?? null, now, now, id]
        : [status, errorMessage ?? null, now, id])
    );

    // Cleanup on terminal states
    if (isTerminal) {
      this.virtualClients.delete(`supervisor_${id}`);
      const timer = this.pendingCooldowns.get(id);
      if (timer) {
        clearTimeout(timer);
        this.pendingCooldowns.delete(id);
      }
    }

    this.broadcastUpdate(id);
  }

  private broadcastUpdate(id: string, log?: SupervisionLog): void {
    if (!this.broadcastFn) return;
    const supervision = this.getSupervision(id);
    if (!supervision) return;

    const msg: SupervisionUpdateMessage = {
      type: 'supervision_update',
      supervision,
      log
    };
    this.broadcastFn(msg as ServerMessage);
  }

  private rowToSupervision(row: SupervisionRow): Supervision {
    return {
      id: row.id,
      sessionId: row.session_id,
      goal: row.goal,
      subtasks: row.subtasks ? JSON.parse(row.subtasks) : undefined,
      status: row.status as SupervisionStatus,
      maxIterations: row.max_iterations,
      currentIteration: row.current_iteration,
      cooldownSeconds: row.cooldown_seconds,
      lastRunId: row.last_run_id || undefined,
      errorMessage: row.error_message || undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at || undefined
    };
  }

  private rowToLog(row: SupervisionLogRow): SupervisionLog {
    return {
      id: row.id,
      supervisionId: row.supervision_id,
      iteration: row.iteration ?? undefined,
      event: row.event as SupervisionLogEvent,
      detail: row.detail ? JSON.parse(row.detail) : undefined,
      createdAt: row.created_at
    };
  }
}
