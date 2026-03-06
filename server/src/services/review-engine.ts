import type { Database } from 'better-sqlite3';
import type {
  SupervisionTask,
  ReviewVerdict,
  TaskResult,
  ServerMessage,
  SupervisionV2LogEvent,
  TrustLevel,
  Session,
} from '@my-claudia/shared';
import { SupervisionTaskRepository } from '../repositories/supervision-task.js';
import { ProjectRepository } from '../repositories/project.js';
import { SessionRepository } from '../repositories/session.js';
import type { ContextManager } from './context-manager.js';
import type { WorktreePool } from './worktree-pool.js';
import { createVirtualClient, handleRunStart } from '../server.js';

const REVIEW_VERDICT_REGEX = /\[REVIEW_VERDICT\]([\s\S]*?)\[\/REVIEW_VERDICT\]/;

export class ReviewEngine {
  private reviewClients = new Map<string, unknown>(); // taskId → virtualClient

  constructor(
    private db: Database,
    private taskRepo: SupervisionTaskRepository,
    private projectRepo: ProjectRepository,
    private sessionRepo: SessionRepository,
    private getContextManager: (projectId: string) => ContextManager,
    private broadcastTaskUpdate: (taskId: string, projectId: string) => void,
    private logFn: (
      projectId: string,
      event: SupervisionV2LogEvent,
      detail?: Record<string, unknown>,
      taskId?: string,
    ) => void,
    private collectGitEvidence: (cwd: string, baseCommit: string) => Promise<string>,
    private getWorktreePool?: (projectId: string) => WorktreePool,
  ) {}

  /**
   * Create a review session, inject objective evidence, trigger Provider run.
   */
  async createReview(task: SupervisionTask): Promise<void> {
    const project = this.projectRepo.findById(task.projectId);
    if (!project?.rootPath) {
      console.error(`[ReviewEngine] Cannot create review for task ${task.id}: project has no rootPath`);
      return;
    }

    // 1. Create review session
    const session = this.sessionRepo.create({
      projectId: task.projectId,
      name: `Review: ${task.title}`,
      type: 'background',
      projectRole: 'review',
      taskId: task.id,
      workingDirectory: project.rootPath,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    // 2. Collect objective evidence (from worktree if parallel, else project root)
    let evidenceCwd = project.rootPath;
    if (task.sessionId) {
      const taskSession = this.sessionRepo.findById(task.sessionId);
      if (taskSession?.workingDirectory) {
        evidenceCwd = taskSession.workingDirectory;
      }
    }

    let evidence = '(no git evidence available)';
    if (task.baseCommit) {
      evidence = await this.collectGitEvidence(evidenceCwd, task.baseCommit);
    }

    // 3. Build review prompt
    const reviewPrompt = this.buildReviewPrompt(task, project.name, evidence);

    // 4. Create virtual client and trigger run
    const clientId = `supervisor_v2_review_${task.id}`;
    const virtualClient = createVirtualClient(clientId, {
      send: (msg: ServerMessage) => {
        this.handleReviewRunMessage(task.id, task.projectId, session.id, msg);
      },
    });
    this.reviewClients.set(task.id, virtualClient);

    handleRunStart(
      virtualClient,
      {
        type: 'run_start',
        clientRequestId: `sv2_review_${task.id}_${Date.now()}`,
        sessionId: session.id,
        input: reviewPrompt,
        workingDirectory: project.rootPath,
      },
      this.db as any,
    );

    this.logFn(
      task.projectId,
      'review_started',
      { taskId: task.id, reviewSessionId: session.id },
      task.id,
    );
  }

  /**
   * Handle messages from the review session's virtual client.
   */
  private handleReviewRunMessage(
    taskId: string,
    projectId: string,
    reviewSessionId: string,
    msg: ServerMessage,
  ): void {
    if (msg.type === 'run_completed') {
      (async () => {
        try {
          const task = this.taskRepo.findById(taskId);
          if (!task || task.status !== 'reviewing') return;

          const verdict = this.parseVerdict(reviewSessionId);
          await this.handleReviewComplete(task, verdict, reviewSessionId);
        } catch (err) {
          console.error(`[ReviewEngine] Error handling review run_completed for task ${taskId}:`, err);
        } finally {
          this.reviewClients.delete(taskId);
        }
      })();
      return;
    }

    if (msg.type === 'run_failed') {
      try {
        const errorMsg = 'error' in msg ? (msg as any).error : 'Review run failed';
        this.logFn(
          projectId,
          'review_failed',
          { taskId, error: errorMsg, reviewSessionId },
          taskId,
        );

        // Don't fail the task — the code changes may be fine.
        // Keep in reviewing for manual intervention.
        const task = this.taskRepo.findById(taskId);
        if (task) {
          const updatedResult: TaskResult = {
            ...(task.result ?? { summary: '', filesChanged: [] }),
            reviewSessionId,
          };
          this.taskRepo.updateStatus(taskId, 'reviewing', { result: updatedResult });
          this.broadcastTaskUpdate(taskId, projectId);
        }

        this.archiveReviewSession(reviewSessionId);
      } catch (err) {
        console.error(`[ReviewEngine] Error handling review run_failed for task ${taskId}:`, err);
      } finally {
        this.reviewClients.delete(taskId);
      }
    }
  }

  /**
   * Parse [REVIEW_VERDICT] from the review session's assistant messages.
   */
  parseVerdict(sessionId: string): ReviewVerdict | null {
    try {
      const messages = this.db
        .prepare(
          `SELECT content FROM messages
           WHERE session_id = ? AND role = 'assistant'
           ORDER BY created_at DESC LIMIT 5`,
        )
        .all(sessionId) as { content: string }[];

      const combined = messages.map((m) => m.content).join('\n');
      const match = REVIEW_VERDICT_REGEX.exec(combined);
      if (!match) return null;

      const block = match[1].trim();
      const approved = /approved:\s*true/i.test(block);

      const notesMatch = block.match(
        /notes:\s*\|?\s*\n([\s\S]*?)(?=suggested_changes:|$)/,
      );
      const notes = notesMatch ? notesMatch[1].trim() : '';

      const suggestionsMatch = block.match(
        /suggested_changes:\s*\n([\s\S]*?)$/,
      );
      const suggestedChanges = suggestionsMatch
        ? suggestionsMatch[1]
            .split('\n')
            .map((l) => l.trim().replace(/^-\s*/, ''))
            .filter(Boolean)
        : undefined;

      return { approved, notes, suggestedChanges };
    } catch {
      return null;
    }
  }

  /**
   * Apply review verdict based on trust level.
   */
  async handleReviewComplete(
    task: SupervisionTask,
    verdict: ReviewVerdict | null,
    reviewSessionId: string,
  ): Promise<void> {
    const project = this.projectRepo.findById(task.projectId);
    const trustLevel: TrustLevel = project?.agent?.config?.trustLevel ?? 'low';

    // Write review result file
    if (project?.rootPath) {
      const cm = this.getContextManager(task.projectId);
      const reviewContent = verdict
        ? `# Review: ${task.title}\n\n## Verdict: ${verdict.approved ? 'APPROVED' : 'REJECTED'}\n\n${verdict.notes}\n${
            verdict.suggestedChanges?.length
              ? '\n## Suggested Changes\n' + verdict.suggestedChanges.map((s) => `- ${s}`).join('\n') + '\n'
              : ''
          }`
        : `# Review: ${task.title}\n\nNo structured verdict found.\n`;
      cm.writeReviewResult(task.id, reviewContent);
    }

    // Attach verdict + reviewSessionId to result
    const updatedResult: TaskResult = {
      ...(task.result ?? { summary: '', filesChanged: [] }),
      reviewVerdict: verdict ?? undefined,
      reviewSessionId,
    };

    // Check if this is a worktree task
    const taskSession = task.sessionId ? this.sessionRepo.findById(task.sessionId) : undefined;
    const isWorktreeTask =
      taskSession?.workingDirectory &&
      project?.rootPath &&
      taskSession.workingDirectory !== project.rootPath;

    if (trustLevel === 'low') {
      // Low trust: keep in reviewing, let user manually confirm
      this.taskRepo.updateStatus(task.id, 'reviewing', { result: updatedResult });
      this.broadcastTaskUpdate(task.id, task.projectId);
      this.logFn(
        task.projectId,
        'review_completed',
        {
          taskId: task.id,
          approved: verdict?.approved,
          trustLevel,
          autoApplied: false,
        },
        task.id,
      );
      this.archiveReviewSession(reviewSessionId);
      return;
    }

    // Medium/high trust: auto-apply verdict
    if (!verdict) {
      // Parse failure: keep in reviewing for manual intervention
      this.taskRepo.updateStatus(task.id, 'reviewing', { result: updatedResult });
      this.broadcastTaskUpdate(task.id, task.projectId);
      this.logFn(
        task.projectId,
        'review_completed',
        { taskId: task.id, verdictParsed: false, trustLevel },
        task.id,
      );
      this.archiveReviewSession(reviewSessionId);
      return;
    }

    if (verdict.approved) {
      // Approved → attempt merge if worktree, otherwise integrated directly
      if (isWorktreeTask && this.getWorktreePool) {
        const pool = this.getWorktreePool(task.projectId);
        this.logFn(task.projectId, 'merge_started', { taskId: task.id }, task.id);

        const mergeResult = await pool.mergeBack(
          task.id,
          task.attempt,
          taskSession!.workingDirectory!,
        );

        if (mergeResult.success) {
          pool.release(taskSession!.workingDirectory!);
          this.taskRepo.updateStatus(task.id, 'integrated', { result: updatedResult });
          this.broadcastTaskUpdate(task.id, task.projectId);
          this.logFn(task.projectId, 'merge_completed', { taskId: task.id }, task.id);
          this.logFn(task.projectId, 'worktree_released', {
            taskId: task.id, worktreePath: taskSession!.workingDirectory,
          }, task.id);
        } else {
          this.taskRepo.updateStatus(task.id, 'merge_conflict', {
            result: {
              ...updatedResult,
              reviewNotes: `Merge conflicts: ${mergeResult.conflicts?.join(', ')}`,
            },
          });
          this.broadcastTaskUpdate(task.id, task.projectId);
          this.logFn(task.projectId, 'merge_conflict', {
            taskId: task.id, conflicts: mergeResult.conflicts,
          }, task.id);
          // Don't release worktree — keep for manual resolution
        }
      } else {
        // Serial mode: approved = integrated
        this.taskRepo.updateStatus(task.id, 'integrated', { result: updatedResult });
        this.broadcastTaskUpdate(task.id, task.projectId);
      }

      this.logFn(
        task.projectId,
        'review_completed',
        {
          taskId: task.id,
          approved: true,
          trustLevel,
          autoApplied: true,
        },
        task.id,
      );
    } else {
      // Rejected → release worktree, then retry or fail
      if (isWorktreeTask && this.getWorktreePool) {
        const pool = this.getWorktreePool(task.projectId);
        pool.release(taskSession!.workingDirectory!);
        this.logFn(task.projectId, 'worktree_released', {
          taskId: task.id, worktreePath: taskSession!.workingDirectory,
        }, task.id);
      }

      if (task.attempt <= task.maxRetries) {
        // Retry: increment attempt, inject reviewNotes, re-queue
        const retryResult: TaskResult = {
          ...updatedResult,
          reviewNotes: verdict.notes,
        };
        this.taskRepo.updateStatus(task.id, 'queued', {
          result: retryResult,
          attempt: task.attempt + 1,
        });
        this.broadcastTaskUpdate(task.id, task.projectId);
        this.logFn(
          task.projectId,
          'review_completed',
          {
            taskId: task.id,
            approved: false,
            trustLevel,
            autoApplied: true,
            retrying: true,
            newAttempt: task.attempt + 1,
          },
          task.id,
        );
      } else {
        // Max retries exceeded → failed
        this.taskRepo.updateStatus(task.id, 'failed', { result: updatedResult });
        this.broadcastTaskUpdate(task.id, task.projectId);
        this.logFn(
          task.projectId,
          'review_completed',
          {
            taskId: task.id,
            approved: false,
            trustLevel,
            autoApplied: true,
            retrying: false,
            maxRetriesExceeded: true,
          },
          task.id,
        );
      }
    }

    this.archiveReviewSession(reviewSessionId);
  }

  /**
   * Build the review system prompt.
   */
  buildReviewPrompt(
    task: SupervisionTask,
    projectName: string,
    evidence: string,
  ): string {
    let prompt = `[INDEPENDENT CODE REVIEW]

You are reviewing the output of an automated coding task. You must evaluate whether the task was completed correctly based on the acceptance criteria and the actual code changes.

CRITICAL: Do NOT trust the task's self-reported summary blindly. Base your review primarily on the OBJECTIVE EVIDENCE (diff) below.

== Task ==
Project: ${projectName}
Title: ${task.title}
Description: ${task.description}
Attempt: ${task.attempt}
`;

    if (task.acceptanceCriteria && task.acceptanceCriteria.length > 0) {
      prompt += `\n== Acceptance Criteria ==\n`;
      for (const ac of task.acceptanceCriteria) {
        prompt += `- ${ac}\n`;
      }
    }

    if (task.result?.summary) {
      prompt += `\n== Task Self-Reported Summary ==\n${task.result.summary}\n`;
    }

    if (task.result?.workflowOutputs && task.result.workflowOutputs.length > 0) {
      prompt += `\n== Workflow Action Results ==\n`;
      for (const wo of task.result.workflowOutputs) {
        prompt += `Action: ${wo.action}\nSuccess: ${wo.success}\nOutput:\n${wo.output}\n\n`;
      }
    }

    prompt += `\n== Objective Evidence (Code Diff) ==
\`\`\`diff
${evidence}
\`\`\`

== Instructions ==
Evaluate the changes against the acceptance criteria. Consider:
1. Do the code changes actually implement what the task requires?
2. Did all workflow actions (tests, lint) pass?
3. Are there any obvious bugs, regressions, or missing pieces?
4. Is the code quality acceptable?

Output your verdict in this exact format:

[REVIEW_VERDICT]
approved: true/false
notes: |
  <your detailed review notes>
suggested_changes:
  - <suggestion 1 if rejected>
  - <suggestion 2 if rejected>
[/REVIEW_VERDICT]
`;

    return prompt;
  }

  /**
   * Archive a review session after completion.
   */
  archiveReviewSession(sessionId: string): void {
    try {
      this.sessionRepo.update(sessionId, { archivedAt: Date.now() });
    } catch (err) {
      console.error(`[ReviewEngine] Failed to archive review session ${sessionId}:`, err);
    }
  }
}
