import { exec, execSync } from 'child_process';
import { promisify } from 'util';
import type { Database } from 'better-sqlite3';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type {
  SupervisionTask,
  TaskResult,
  SupervisionLogEvent,
} from '@my-claudia/shared/features/supervision';
import { SupervisionTaskRepository } from '../../infrastructure/repositories/supervision-task.js';
import { ProjectRepository } from '../projects/repository.js';
import type { ContextManager, WorkflowAction } from './context-manager.js';
import {
  assertTaskStatus,
  assertTaskTransition,
} from './status-machine.js';

const execAsync = promisify(exec);
const TASK_RESULT_REGEX = /\[TASK_RESULT\]([\s\S]*?)\[\/TASK_RESULT\]/;
const REVIEW_TRIGGER_TIMEOUT_MS = 15_000;

export class TaskRunner {
  constructor(
    private db: Database,
    private taskRepo: SupervisionTaskRepository,
    private projectRepo: ProjectRepository,
    private getContextManager: (projectId: string) => ContextManager,
    private broadcastTaskUpdate: (taskId: string, projectId: string) => void,
    private logFn: (
      projectId: string,
      event: SupervisionLogEvent,
      detail?: Record<string, unknown>,
      taskId?: string,
    ) => void,
    private onReadyForReview: (task: SupervisionTask) => Promise<void>,
  ) {}

  /**
   * Full pipeline: parse result → workflow actions → auto-commit → write result → reviewing → trigger review
   */
  async onTaskComplete(taskId: string, projectId: string): Promise<void> {
    const task = this.taskRepo.findById(taskId);
    if (!task) return;
    assertTaskStatus(task.status, 'running', `complete task ${taskId}`);

    const project = this.projectRepo.findById(projectId);
    if (!project?.rootPath) {
      console.error(`[TaskRunner] Cannot complete task ${taskId}: project has no rootPath`);
      return;
    }

    // Use session's workingDirectory (may be a worktree) instead of project.rootPath
    let cwd = project.rootPath;
    if (task.sessionId) {
      const sessionRow = this.db
        .prepare('SELECT working_directory FROM sessions WHERE id = ?')
        .get(task.sessionId) as { working_directory: string } | undefined;
      if (sessionRow?.working_directory) {
        cwd = sessionRow.working_directory;
      }
    }

    // 1. Parse [TASK_RESULT] from session messages
    const result = task.sessionId ? this.parseTaskResult(task.sessionId) : null;

    // 2. Execute workflow actions (onTaskComplete)
    const cm = this.getContextManager(projectId);
    const workflow = cm.getWorkflow();
    const workflowOutputs = await this.executeWorkflowActions(
      workflow.onTaskComplete,
      cwd,
    );
    const taskResult: TaskResult = result
      ? { ...result, workflowOutputs }
      : { summary: 'Completed (no structured result)', filesChanged: [], workflowOutputs };

    // 3. Auto-commit remaining changes (git only)
    if (this.isGitProject(cwd)) {
      await this.autoCommitRemainingChanges(cwd, taskId);
    }

    // 4. Write result to .supervision/results/task-{id}.md
    const resultContent = this.formatTaskResult(task, taskResult);
    cm.writeTaskResult(taskId, resultContent);

    // 5. Update task status → reviewing
    assertTaskTransition(task.status, 'reviewing');
    this.taskRepo.updateStatus(taskId, 'reviewing', { result: taskResult });
    this.broadcastTaskUpdate(taskId, projectId);
    this.logFn(
      projectId,
      'task_status_changed',
      { taskId, from: 'running', to: 'reviewing' },
      taskId,
    );

    // 6. Trigger review
    const updatedTask = this.taskRepo.findById(taskId)!;
    try {
      await this.withTimeout(
        this.onReadyForReview(updatedTask),
        REVIEW_TRIGGER_TIMEOUT_MS,
        'onReadyForReview timed out',
      );
    } catch (err) {
      this.logFn(
        projectId,
        'review_started',
        {
          taskId,
          timedOut: true,
          error: err instanceof Error ? err.message : String(err),
        },
        taskId,
      );
    }
  }

  /**
   * Extract [TASK_RESULT] from the last assistant messages of a session.
   */
  parseTaskResult(sessionId: string): TaskResult | null {
    try {
      const messages = this.db
        .prepare(
          `SELECT content FROM messages
           WHERE session_id = ? AND role = 'assistant'
           ORDER BY created_at DESC LIMIT 5`,
        )
        .all(sessionId) as { content: string }[];

      for (const msg of messages) {
        const match = TASK_RESULT_REGEX.exec(msg.content);
        if (match) {
          const block = match[1].trim();
          const summaryMatch = /^\s*-\s*summary:\s*(.+)\s*$/im.exec(block);
          const filesMatch = /^\s*-\s*files_changed:\s*(.*)\s*$/im.exec(block);
          const testsMatch = /^\s*-\s*tests:\s*(.+)\s*$/im.exec(block);

          if (!summaryMatch || !filesMatch) {
            return null;
          }

          return {
            summary: summaryMatch[1].trim(),
            filesChanged: filesMatch[1].trim()
              ? filesMatch[1]
                  .split(',')
                  .map((f) => f.trim())
                  .filter(Boolean)
              : [],
            workflowOutputs: testsMatch
              ? [{ action: 'tests', output: testsMatch[1].trim(), success: true }]
              : undefined,
          };
        }
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Execute workflow actions (from workflow.yaml onTaskComplete).
   */
  async executeWorkflowActions(
    actions: WorkflowAction[],
    cwd: string,
  ): Promise<Array<{ action: string; output: string; success: boolean }>> {
    const results: Array<{ action: string; output: string; success: boolean }> = [];

    for (const action of actions) {
      if (action.type === 'run_command' && action.command) {
        const label = action.description || action.command;
        try {
          const { stdout, stderr } = await execAsync(action.command, {
            cwd,
            timeout: 120_000,
          });
          results.push({
            action: label,
            output: (stdout + stderr).slice(0, 10_000),
            success: true,
          });
        } catch (err: unknown) {
          const execErr = err as { stdout?: string; stderr?: string };
          results.push({
            action: label,
            output: ((execErr.stdout ?? '') + (execErr.stderr ?? '')).slice(0, 10_000),
            success: false,
          });
        }
      }
    }

    return results;
  }

  /**
   * Auto-commit any remaining uncommitted changes after a task run.
   */
  async autoCommitRemainingChanges(cwd: string, taskId: string): Promise<void> {
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd });
      if (!stdout.trim()) return;

      await execAsync('git add -A', { cwd });
      await execAsync(
        `git commit -m "chore(supervision): auto-commit remaining changes for task ${taskId}"`,
        { cwd },
      );
    } catch {
      // Non-critical: if commit fails, continue
    }
  }

  /**
   * Collect git diff evidence for review.
   */
  async collectGitEvidence(cwd: string, baseCommit: string): Promise<string> {
    try {
      const { stdout } = await execAsync(
        `git diff ${baseCommit}..HEAD`,
        { cwd, maxBuffer: 1024 * 1024 },
      );
      if (stdout.length > 50_000) {
        return stdout.slice(0, 50_000) + '\n\n[... diff truncated at 50KB ...]';
      }
      return stdout;
    } catch {
      return '(failed to collect git diff)';
    }
  }

  /**
   * Check whether a path is inside a git repository.
   */
  isGitProject(rootPath: string): boolean {
    try {
      execSync('git rev-parse --is-inside-work-tree', {
        cwd: rootPath,
        encoding: 'utf-8',
        stdio: 'pipe',
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Format task result as markdown for .supervision/results/task-{id}.md.
   */
  formatTaskResult(task: SupervisionTask, result: TaskResult): string {
    let content = `# Task Result: ${task.title}\n\n`;
    content += `## Summary\n${result.summary}\n\n`;

    if (result.filesChanged.length > 0) {
      content += `## Files Changed\n${result.filesChanged.join('\n')}\n\n`;
    }

    if (result.workflowOutputs && result.workflowOutputs.length > 0) {
      content += `## Workflow Action Results\n`;
      for (const wo of result.workflowOutputs) {
        content += `### ${wo.action} (${wo.success ? 'PASSED' : 'FAILED'})\n`;
        content += `\`\`\`\n${wo.output}\n\`\`\`\n\n`;
      }
    }

    return content;
  }

  private withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err) => {
          clearTimeout(timer);
          reject(err);
        },
      );
    });
  }
}
