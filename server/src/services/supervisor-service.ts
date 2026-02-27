import { v4 as uuidv4 } from 'uuid';
import type Database from 'better-sqlite3';
import type {
  Supervision,
  SupervisionStatus,
  SupervisionSubtask,
  SupervisionLog,
  SupervisionLogEvent,
  SupervisionUpdateMessage,
  SupervisionPlan,
  ServerMessage,
  Message
} from '@my-claudia/shared';
import { createVirtualClient, handleRunStart, activeRuns, sendMessage } from '../server.js';
import type { ConnectedClient } from '../server.js';
import type { NotificationService } from './notification-service.js';

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
  plan_session_id: string | null;
  acceptance_criteria: string | null;
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
  private notificationService: NotificationService | null = null;
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  setNotificationService(service: NotificationService): void {
    this.notificationService = service;
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
      const prompt = this.buildInitialPrompt(sup.goal, sup.subtasks, sup.acceptanceCriteria);
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
          // Forward all streaming messages to real connected clients
          if (this.broadcastFn) {
            this.broadcastFn(msg);
          }
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
      const prompt = this.buildContinuePrompt(sup.goal, current.current_iteration + 1, sup.subtasks, sup.acceptanceCriteria);
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

  private buildInitialPrompt(goal: string, subtasks?: SupervisionSubtask[], acceptanceCriteria?: string[]): string {
    let prompt = `[SUPERVISED SESSION]\nGoal: ${goal}\n\nContinue working based on our previous conversation.\n`;

    if (acceptanceCriteria && acceptanceCriteria.length > 0) {
      prompt += '\nAcceptance Criteria:\n';
      for (const ac of acceptanceCriteria) {
        prompt += `- ${ac}\n`;
      }
    }

    if (subtasks && subtasks.length > 0) {
      // Group by phase
      const phases = new Map<number, SupervisionSubtask[]>();
      for (const st of subtasks) {
        const phase = st.phase || 1;
        if (!phases.has(phase)) phases.set(phase, []);
        phases.get(phase)!.push(st);
      }

      for (const [phase, tasks] of [...phases.entries()].sort((a, b) => a[0] - b[0])) {
        prompt += `\nPhase ${phase}:\n`;
        for (const st of tasks) {
          prompt += `${st.id}. [ ] ${st.description}\n`;
          if (st.acceptanceCriteria?.length) {
            for (const ac of st.acceptanceCriteria) {
              prompt += `   - Done when: ${ac}\n`;
            }
          }
        }
      }
      prompt += '\nWhen you complete a subtask, include [SUBTASK_COMPLETE:N] (where N is the subtask number) in your response.\n';
    }

    prompt += '\nWhen the goal is fully achieved (all acceptance criteria met), include [GOAL_COMPLETE] in your response.\nIf you encounter a blocker, explain what is preventing progress.\n\nPlease begin working now.';
    return prompt;
  }

  private buildContinuePrompt(goal: string, iteration: number, subtasks?: SupervisionSubtask[], acceptanceCriteria?: string[]): string {
    let prompt = `[SUPERVISION CONTINUE - Iteration ${iteration}]\nThe previous run completed but the goal is not yet met.\n\nGoal: ${goal}\n`;

    if (acceptanceCriteria && acceptanceCriteria.length > 0) {
      prompt += '\nAcceptance Criteria:\n';
      for (const ac of acceptanceCriteria) {
        prompt += `- ${ac}\n`;
      }
    }

    if (subtasks && subtasks.length > 0) {
      // Group by phase
      const phases = new Map<number, SupervisionSubtask[]>();
      for (const st of subtasks) {
        const phase = st.phase || 1;
        if (!phases.has(phase)) phases.set(phase, []);
        phases.get(phase)!.push(st);
      }

      prompt += '\nSubtask progress:\n';
      for (const [phase, tasks] of [...phases.entries()].sort((a, b) => a[0] - b[0])) {
        prompt += `Phase ${phase}:\n`;
        for (const st of tasks) {
          const mark = st.status === 'completed' ? 'x' : ' ';
          prompt += `${st.id}. [${mark}] ${st.description}${st.status === 'completed' ? ' (done)' : ''}\n`;
        }
      }
      prompt += '\nContinue working on the remaining subtasks. Mark completed ones with [SUBTASK_COMPLETE:N].\n';
    }

    prompt += '\nWhen the goal is fully achieved (all acceptance criteria met), include [GOAL_COMPLETE] in your response.\nIf blocked, explain what is preventing progress.';
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
      `SELECT id FROM supervisions WHERE session_id = ? AND status IN ('planning', 'active', 'paused')`
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

  // ========================================
  // Planning
  // ========================================

  startPlanning(
    sessionId: string,
    hint: string,
    options?: { maxIterations?: number; cooldownSeconds?: number }
  ): { supervision: Supervision; planSessionId: string } {
    // Enforce one active supervision per session (reuses same check as create)
    const existing = this.db.prepare(
      `SELECT id FROM supervisions WHERE session_id = ? AND status IN ('planning', 'active', 'paused')`
    ).get(sessionId);
    if (existing) {
      throw new Error('Session already has an active supervision');
    }

    const supervisionId = uuidv4();
    const planSessionId = uuidv4();
    const now = Date.now();

    // Create a background session for the planning conversation
    this.db.prepare(`
      INSERT INTO sessions (id, project_id, name, type, created_at, updated_at)
      VALUES (?, (SELECT project_id FROM sessions WHERE id = ?), ?, 'background', ?, ?)
    `).run(planSessionId, sessionId, `Planning: ${hint.slice(0, 50)}`, now, now);

    // Create supervision in 'planning' status
    this.db.prepare(`
      INSERT INTO supervisions (id, session_id, goal, status, plan_session_id, max_iterations, cooldown_seconds, current_iteration, created_at, updated_at)
      VALUES (?, ?, ?, 'planning', ?, ?, ?, 0, ?, ?)
    `).run(
      supervisionId, sessionId, hint, planSessionId,
      options?.maxIterations ?? 5,
      options?.cooldownSeconds ?? 5,
      now, now
    );

    this.appendLog(supervisionId, 'planning_started');

    // Read recent messages from target session for context
    const recentMessages = this.db.prepare(`
      SELECT role, content FROM messages
      WHERE session_id = ?
      ORDER BY created_at DESC LIMIT 20
    `).all(sessionId) as { role: string; content: string }[];

    // Build context summary from recent messages (reverse to chronological order)
    const contextLines = recentMessages.reverse().map(m =>
      `[${m.role}]: ${m.content.slice(0, 500)}`
    ).join('\n');

    // Build the initial planning prompt
    const planningInput = this.buildPlanningInitialMessage(hint, contextLines);

    // Trigger the first planning run via virtual client
    const clientId = `planner_${supervisionId}`;
    const virtualClient = createVirtualClient(clientId, {
      send: (msg: ServerMessage) => {
        // Forward streaming messages to real connected clients
        if (this.broadcastFn) {
          this.broadcastFn(msg);
        }
      }
    });
    this.virtualClients.set(clientId, virtualClient);

    handleRunStart(virtualClient, {
      type: 'run_start',
      clientRequestId: `planning_${supervisionId}_${Date.now()}`,
      sessionId: planSessionId,
      input: planningInput,
      systemContext: this.buildPlanningSystemPrompt(),
    }, this.db);

    const supervision = this.getSupervision(supervisionId)!;
    this.broadcastUpdate(supervisionId);

    return { supervision, planSessionId };
  }

  respondToPlanning(supervisionId: string, message: string): void {
    const row = this.getSupervisionRow(supervisionId);
    if (!row || row.status !== 'planning') {
      throw new Error('Supervision is not in planning status');
    }
    if (!row.plan_session_id) {
      throw new Error('No planning session found');
    }

    // Trigger a new run on the plan session with the user's response
    const clientId = `planner_${supervisionId}`;
    let virtualClient = this.virtualClients.get(clientId);
    if (!virtualClient) {
      virtualClient = createVirtualClient(clientId, {
        send: (msg: ServerMessage) => {
          if (this.broadcastFn) {
            this.broadcastFn(msg);
          }
        }
      });
      this.virtualClients.set(clientId, virtualClient);
    }

    handleRunStart(virtualClient, {
      type: 'run_start',
      clientRequestId: `planning_${supervisionId}_${Date.now()}`,
      sessionId: row.plan_session_id,
      input: message,
      systemContext: this.buildPlanningSystemPrompt(),
    }, this.db);
  }

  approvePlan(
    supervisionId: string,
    plan: SupervisionPlan & { maxIterations?: number; cooldownSeconds?: number }
  ): Supervision {
    const row = this.getSupervisionRow(supervisionId);
    if (!row || row.status !== 'planning') {
      throw new Error('Supervision is not in planning status');
    }

    const now = Date.now();

    // Build subtasks with phase and acceptance criteria
    const subtasks: SupervisionSubtask[] = plan.subtasks.map((st, idx) => ({
      id: idx + 1,
      description: st.description,
      status: 'pending' as const,
      phase: st.phase,
      acceptanceCriteria: st.acceptanceCriteria,
    }));

    // Dynamic maxIterations
    const defaultMaxIterations = subtasks.length > 0 ? subtasks.length * 3 : 5;

    this.db.prepare(`
      UPDATE supervisions
      SET goal = ?, subtasks = ?, acceptance_criteria = ?, status = 'active',
          max_iterations = ?, cooldown_seconds = ?, last_run_id = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      plan.goal,
      JSON.stringify(subtasks),
      plan.acceptanceCriteria ? JSON.stringify(plan.acceptanceCriteria) : null,
      plan.maxIterations ?? defaultMaxIterations,
      plan.cooldownSeconds ?? row.cooldown_seconds,
      now,
      supervisionId
    );

    this.appendLog(supervisionId, 'planning_approved', undefined, {
      goal: plan.goal,
      subtaskCount: subtasks.length,
      acceptanceCriteriaCount: plan.acceptanceCriteria?.length ?? 0,
    });

    // Cleanup planning virtual client
    this.virtualClients.delete(`planner_${supervisionId}`);

    return this.getSupervision(supervisionId)!;
  }

  cancelPlanning(id: string): Supervision {
    const row = this.getSupervisionRow(id);
    if (!row || row.status !== 'planning') {
      throw new Error('Supervision is not in planning status');
    }

    this.updateStatus(id, 'cancelled', 'Planning cancelled by user');
    this.virtualClients.delete(`planner_${id}`);
    this.appendLog(id, 'planning_cancelled');
    return this.getSupervision(id)!;
  }

  getPlanConversation(supervisionId: string): Message[] {
    const row = this.getSupervisionRow(supervisionId);
    if (!row || !row.plan_session_id) {
      return [];
    }

    const messages = this.db.prepare(`
      SELECT id, session_id, role, content, metadata, created_at
      FROM messages
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(row.plan_session_id) as Array<{
      id: string; session_id: string; role: string;
      content: string; metadata: string | null; created_at: number;
    }>;

    return messages.map(m => ({
      id: m.id,
      sessionId: m.session_id,
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
      metadata: m.metadata ? JSON.parse(m.metadata) : undefined,
      createdAt: m.created_at,
    }));
  }

  private buildPlanningSystemPrompt(): string {
    return `You are a goal planning assistant for an AI supervision system. Your job is to help the user define a clear, actionable plan for an automated AI coding session.

## Your Process
1. Analyze the session context and the user's goal description
2. Ask 2-4 focused clarifying questions to understand scope, priorities, and constraints
3. After the user answers, either ask brief follow-up questions OR propose a structured plan
4. You should complete the planning in at most 2-3 rounds of conversation

## Plan Output Format
When you have enough information, output a plan as a JSON block wrapped in \`\`\`json fences:

\`\`\`json
{
  "goal": "Precise, detailed description of the overall goal",
  "subtasks": [
    {
      "description": "Clear subtask description",
      "phase": 1,
      "acceptanceCriteria": ["Concrete verifiable criterion"]
    }
  ],
  "acceptanceCriteria": ["Overall goal criterion 1", "Overall goal criterion 2"],
  "estimatedIterations": 10
}
\`\`\`

## Rules
- Keep questions concise and focused — ask at most 4 questions per round
- Subtasks should be ordered by phase (1, 2, 3...) for logical execution order
- Acceptance criteria must be concrete and verifiable (not vague like "works well")
- When proposing a plan, always include the JSON block so the system can parse it
- Keep the total number of subtasks reasonable (3-10 for most goals)
- Estimate iterations conservatively (each subtask typically needs 2-3 iterations)`;
  }

  private buildPlanningInitialMessage(hint: string, sessionContext: string): string {
    let message = '';

    if (sessionContext.trim()) {
      message += `[SESSION CONTEXT]\nHere is the recent conversation from the target coding session:\n\n${sessionContext}\n\n`;
    }

    message += `[USER'S GOAL]\n${hint}\n\nPlease analyze the context and ask clarifying questions to help refine this into a detailed, actionable plan.`;
    return message;
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
      `SELECT * FROM supervisions WHERE session_id = ? AND status IN ('planning', 'active', 'paused') LIMIT 1`
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

      // Send push notification for terminal states
      if (this.notificationService) {
        const sup = this.getSupervision(id);
        this.notificationService.notify({
          type: 'supervision_update',
          title: `Supervision ${status}`,
          body: sup?.goal?.slice(0, 200) || `Supervision ${id}`,
          priority: status === 'failed' ? 'high' : 'default',
          tags: [status === 'completed' ? 'white_check_mark' : status === 'failed' ? 'x' : 'stop_sign'],
        });
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
      acceptanceCriteria: row.acceptance_criteria ? JSON.parse(row.acceptance_criteria) : undefined,
      planSessionId: row.plan_session_id || undefined,
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
