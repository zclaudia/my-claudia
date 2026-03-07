import type { Database } from 'better-sqlite3';
import type {
  Session,
  ProjectAgent,
  SupervisionTask,
  SupervisionV2LogEvent,
  ServerMessage,
} from '@my-claudia/shared';
import { SupervisionTaskRepository } from '../repositories/supervision-task.js';
import { ProjectRepository } from '../repositories/project.js';
import { SessionRepository } from '../repositories/session.js';
import type { ContextManager, CheckpointTrigger } from './context-manager.js';

export interface CheckpointResult {
  projectSummaryUpdate?: string;
  knowledgeUpdates?: Array<{ docId: string; content: string }>;
  discoveredTasks?: Array<{ title: string; description: string }>;
}

const CHECKPOINT_RESULT_REGEX = /\[CHECKPOINT_RESULT\]([\s\S]*?)\[\/CHECKPOINT_RESULT\]/;

export class CheckpointEngine {
  private runningCheckpoints = new Set<string>(); // projectId set
  private intervalTimers = new Map<string, NodeJS.Timeout>();

  constructor(
    private db: Database,
    private taskRepo: SupervisionTaskRepository,
    private projectRepo: ProjectRepository,
    private sessionRepo: SessionRepository,
    private getContextManager: (projectId: string) => ContextManager,
    private broadcastFn: (msg: ServerMessage) => void,
    private logFn: (
      projectId: string,
      event: SupervisionV2LogEvent,
      detail?: Record<string, unknown>,
      taskId?: string,
    ) => void,
    private createTaskFn: (
      projectId: string,
      data: { title: string; description: string; source: 'agent_discovered' },
    ) => SupervisionTask,
    private createVirtualClientFn: (
      clientId: string,
      options: { send: (msg: ServerMessage) => void },
    ) => unknown,
    private handleRunStartFn: (
      client: unknown,
      msg: {
        type: string;
        clientRequestId: string;
        sessionId: string;
        input: string;
        workingDirectory: string;
      },
      db: Database,
    ) => void,
  ) {}

  shouldTrigger(projectId: string, event: 'task_complete' | 'idle'): boolean {
    const project = this.projectRepo.findById(projectId);
    if (!project?.agent) return false;

    // Don't trigger if agent is paused/archived
    if (project.agent.phase === 'paused' || project.agent.phase === 'archived') {
      return false;
    }

    // Don't trigger if already running a checkpoint for this project
    if (this.runningCheckpoints.has(projectId)) {
      return false;
    }

    // Check if any unarchived checkpoint session exists (concurrent protection)
    const checkpointSessions = this.sessionRepo.findByProjectRole(projectId, 'checkpoint');
    if (checkpointSessions.some(s => !s.archivedAt)) {
      return false;
    }

    const cm = this.getContextManager(projectId);
    const workflow = cm.getWorkflow();
    const trigger = workflow.checkpointTrigger;

    return this.matchesTrigger(trigger, event);
  }

  private matchesTrigger(trigger: CheckpointTrigger, event: 'task_complete' | 'idle'): boolean {
    switch (trigger.type) {
      case 'on_task_complete':
        return event === 'task_complete';
      case 'on_idle':
        return event === 'idle';
      case 'interval':
        // Interval is handled separately via startInterval()
        return false;
      case 'combined':
        return trigger.triggers.some(t => this.matchesTrigger(t, event));
      default:
        return false;
    }
  }

  async runCheckpoint(projectId: string): Promise<void> {
    const project = this.projectRepo.findById(projectId);
    if (!project?.agent || !project.rootPath) return;

    this.runningCheckpoints.add(projectId);
    this.logFn(projectId, 'checkpoint_started', {});

    try {
      // Create checkpoint session
      const session = this.sessionRepo.create({
        projectId,
        name: 'Checkpoint',
        type: 'background',
        projectRole: 'checkpoint',
      } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

      const cm = this.getContextManager(projectId);
      const prompt = this.buildCheckpointPrompt(project.name, cm);

      const clientId = `checkpoint_${projectId}_${Date.now()}`;
      const virtualClient = this.createVirtualClientFn(clientId, {
        send: (msg: ServerMessage) => {
          this.handleCheckpointRunMessage(projectId, session.id, msg);
        },
      });

      this.handleRunStartFn(
        virtualClient,
        {
          type: 'run_start',
          clientRequestId: `ckpt_${projectId}_${Date.now()}`,
          sessionId: session.id,
          input: prompt,
          workingDirectory: project.rootPath,
        },
        this.db,
      );
    } catch (err) {
      this.runningCheckpoints.delete(projectId);
      this.logFn(projectId, 'checkpoint_completed', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private handleCheckpointRunMessage(
    projectId: string,
    sessionId: string,
    msg: ServerMessage,
  ): void {
    if (msg.type === 'run_completed') {
      try {
        const result = this.parseCheckpointResult(sessionId);
        if (result) {
          this.applyCheckpointResult(projectId, result);
        }
        this.logFn(projectId, 'checkpoint_completed', {
          hasResult: !!result,
        });
      } catch (err) {
        this.logFn(projectId, 'checkpoint_completed', {
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        this.runningCheckpoints.delete(projectId);
        this.sessionRepo.update(sessionId, { archivedAt: Date.now() });
      }

      this.broadcastFn({
        type: 'supervision_checkpoint',
        projectId,
        summary: 'Checkpoint completed',
      } as ServerMessage);
      return;
    }

    if (msg.type === 'run_failed') {
      this.runningCheckpoints.delete(projectId);
      this.sessionRepo.update(sessionId, { archivedAt: Date.now() });
      this.logFn(projectId, 'checkpoint_completed', {
        error: 'run_failed',
      });
    }
  }

  parseCheckpointResult(sessionId: string): CheckpointResult | null {
    const rows = this.db.prepare(`
      SELECT content FROM messages
      WHERE session_id = ? AND role = 'assistant'
      ORDER BY created_at DESC
    `).all(sessionId) as Array<{ content: string }>;

    for (const row of rows) {
      const match = CHECKPOINT_RESULT_REGEX.exec(row.content);
      if (match) {
        return this.parseResultBlock(match[1]);
      }
    }

    return null;
  }

  private parseResultBlock(raw: string): CheckpointResult {
    const result: CheckpointResult = {};

    // Parse project summary update
    const summaryMatch = /project_summary_update:\s*\|([\s\S]*?)(?=knowledge_updates:|discovered_tasks:|$)/i.exec(raw);
    if (summaryMatch) {
      result.projectSummaryUpdate = summaryMatch[1].trim();
    }

    // Parse knowledge updates
    const knowledgeMatch = /knowledge_updates:\s*\n([\s\S]*?)(?=discovered_tasks:|$)/i.exec(raw);
    if (knowledgeMatch) {
      const updates: Array<{ docId: string; content: string }> = [];
      const entries = ('\n' + knowledgeMatch[1]).split(/\n\s*-\s+doc_id:\s*/);
      for (const entry of entries) {
        if (!entry.trim()) continue;
        const docIdMatch = /^(.+?)(?:\n\s+content:\s*\|?\s*\n([\s\S]*?))?$/m.exec(entry.trim());
        if (docIdMatch) {
          updates.push({
            docId: docIdMatch[1].trim(),
            content: (docIdMatch[2] || '').trim(),
          });
        }
      }
      if (updates.length > 0) {
        result.knowledgeUpdates = updates;
      }
    }

    // Parse discovered tasks
    const tasksMatch = /discovered_tasks:\s*\n([\s\S]*?)$/i.exec(raw);
    if (tasksMatch) {
      const tasks: Array<{ title: string; description: string }> = [];
      const entries = ('\n' + tasksMatch[1]).split(/\n\s*-\s+title:\s*/);
      for (const entry of entries) {
        if (!entry.trim()) continue;
        const titleMatch = /^(.+?)(?:\n\s+description:\s*(.+))?$/m.exec(entry.trim());
        if (titleMatch) {
          tasks.push({
            title: titleMatch[1].trim(),
            description: (titleMatch[2] || '').trim(),
          });
        }
      }
      if (tasks.length > 0) {
        result.discoveredTasks = tasks;
      }
    }

    return result;
  }

  private applyCheckpointResult(projectId: string, result: CheckpointResult): void {
    const cm = this.getContextManager(projectId);

    // Update project summary
    if (result.projectSummaryUpdate) {
      cm.updateProjectSummary(result.projectSummaryUpdate);
      this.logFn(projectId, 'context_updated', { type: 'project_summary' });
    }

    // Update knowledge documents
    if (result.knowledgeUpdates) {
      for (const update of result.knowledgeUpdates) {
        cm.updateDocument(update.docId, update.content, {
          category: 'knowledge',
          source: 'agent',
        });
        this.logFn(projectId, 'context_updated', {
          type: 'knowledge',
          docId: update.docId,
        });
      }
    }

    // Create discovered tasks
    if (result.discoveredTasks) {
      const project = this.projectRepo.findById(projectId);
      if (project?.agent?.config?.autoDiscoverTasks) {
        for (const taskData of result.discoveredTasks) {
          try {
            this.createTaskFn(projectId, {
              title: taskData.title,
              description: taskData.description,
              source: 'agent_discovered',
            });
          } catch (err) {
            // Budget limit or other error — log but don't fail checkpoint
            console.error(`[CheckpointEngine] Failed to create discovered task:`, err);
          }
        }
      }
    }
  }

  private buildCheckpointPrompt(projectName: string, cm: ContextManager): string {
    const summary = cm.getProjectSummary() || '(no project summary yet)';
    const { documents } = cm.loadAll();

    let contextSection = '';
    for (const doc of documents) {
      contextSection += `\n### ${doc.id} (${doc.category})\n${doc.content.trim()}\n`;
    }

    return `[PROJECT CHECKPOINT]
Project: ${projectName}

== Current Project Summary ==
${summary}

== Current Knowledge Base ==${contextSection || '\n(empty)'}

== Instructions ==
You are performing a project checkpoint. Your job is to:

1. Review the current project state and recent task results
2. Update the project summary with any new insights
3. Update knowledge documents if needed
4. Identify any new tasks that should be created

Output your results in this exact format:

[CHECKPOINT_RESULT]
project_summary_update: |
  <updated project summary content>
knowledge_updates:
  - doc_id: <relative path, e.g. knowledge/api-patterns.md>
    content: |
      <updated content>
discovered_tasks:
  - title: <task title>
    description: <task description>
[/CHECKPOINT_RESULT]

Only include sections that have actual updates. If nothing needs updating, output an empty result block.
`;
  }

  startInterval(projectId: string, minutes: number): void {
    this.stopInterval(projectId);
    const ms = minutes * 60 * 1000;
    const timer = setInterval(() => {
      if (this.shouldTrigger(projectId, 'task_complete')) {
        this.runCheckpoint(projectId).catch((err) => {
          console.error(`[CheckpointEngine] Interval checkpoint failed for ${projectId}:`, err);
        });
      }
    }, ms);
    this.intervalTimers.set(projectId, timer);
  }

  stopInterval(projectId: string): void {
    const timer = this.intervalTimers.get(projectId);
    if (timer) {
      clearInterval(timer);
      this.intervalTimers.delete(projectId);
    }
  }

  stop(): void {
    for (const [, timer] of this.intervalTimers) {
      clearInterval(timer);
    }
    this.intervalTimers.clear();
    this.runningCheckpoints.clear();
  }
}
