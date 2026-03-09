/**
 * Workflow Execution Engine
 *
 * Executes workflow steps sequentially with support for:
 * - Variable interpolation: ${stepId.output.field}
 * - Condition branches: if/then/else
 * - Error handling: abort/skip/retry
 * - Async AI steps via virtual client pattern
 * - Wait/approval steps with external resolution
 */

import type { Database } from 'better-sqlite3';
import type {
  WorkflowStepDef,
  WorkflowStepRun,
  WorkflowRun,
  WorkflowDefinition,
  ServerMessage,
  Session,
} from '@my-claudia/shared';
import { WorkflowRunRepository } from '../repositories/workflow-run.js';
import { WorkflowStepRunRepository } from '../repositories/workflow-step-run.js';
import { ProjectRepository } from '../repositories/project.js';
import { SessionRepository } from '../repositories/session.js';
import { createVirtualClient, handleRunStart } from '../server.js';
import { pluginEvents } from '../events/index.js';
import { workflowStepRegistry } from '../plugins/workflow-step-registry.js';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFileCb);

const DEFAULT_STEP_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

export interface StepResult {
  status: 'completed' | 'failed' | 'skipped';
  output: Record<string, unknown>;
  error?: string;
}

export interface ExecutionContext {
  results: Map<string, StepResult>;
  run: WorkflowRun;
  projectId: string;
  projectRootPath?: string;
  providerId?: string;
  skippedByCondition: Set<string>;
}

export class WorkflowEngine {
  private runRepo: WorkflowRunRepository;
  private stepRunRepo: WorkflowStepRunRepository;
  private projectRepo: ProjectRepository;
  private sessionRepo: SessionRepository;
  private activeRuns = new Map<string, boolean>();
  private pendingApprovals = new Map<string, {
    resolve: (approved: boolean) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(
    private db: Database,
    private broadcastFn: (projectId: string, message: any) => void,
  ) {
    this.runRepo = new WorkflowRunRepository(db);
    this.stepRunRepo = new WorkflowStepRunRepository(db);
    this.projectRepo = new ProjectRepository(db);
    this.sessionRepo = new SessionRepository(db);
  }

  isRunning(workflowId: string): boolean {
    return this.activeRuns.has(workflowId);
  }

  // ── Main Execution ──────────────────────────────────────────────

  async startRun(
    workflowId: string,
    projectId: string,
    definition: WorkflowDefinition,
    triggerSource: 'manual' | 'schedule' | 'event',
    triggerDetail?: string,
  ): Promise<WorkflowRun> {
    if (this.activeRuns.has(workflowId)) {
      throw new Error(`Workflow ${workflowId} is already running`);
    }

    const project = this.projectRepo.findById(projectId);

    // Create run record
    const run = this.runRepo.create({
      workflowId,
      projectId,
      status: 'running',
      triggerSource,
      triggerDetail,
      startedAt: Date.now(),
    });

    // Create step run records for all steps
    for (const step of definition.steps) {
      this.stepRunRepo.create({
        runId: run.id,
        stepId: step.id,
        stepType: step.type,
        status: 'pending',
        attempt: 1,
      });
    }

    this.broadcastRunUpdate(projectId, run.id);
    this.activeRuns.set(workflowId, true);

    // Execute asynchronously
    this.executeSteps(run, definition, project?.rootPath, project?.providerId)
      .catch((err) => {
        console.error(`[Workflow] Run ${run.id} failed:`, err);
      })
      .finally(() => {
        this.activeRuns.delete(workflowId);
      });

    return run;
  }

  private async executeSteps(
    run: WorkflowRun,
    definition: WorkflowDefinition,
    projectRootPath?: string,
    providerId?: string,
  ): Promise<void> {
    const ctx: ExecutionContext = {
      results: new Map(),
      run,
      projectId: run.projectId,
      projectRootPath,
      providerId,
      skippedByCondition: new Set(),
    };

    for (const stepDef of definition.steps) {
      // Check if run was cancelled
      const currentRun = this.runRepo.findById(run.id);
      if (!currentRun || currentRun.status === 'cancelled') {
        return;
      }

      // Skip steps excluded by condition branches
      if (ctx.skippedByCondition.has(stepDef.id)) {
        const stepRun = this.stepRunRepo.findByRunAndStep(run.id, stepDef.id);
        if (stepRun) {
          this.stepRunRepo.update(stepRun.id, { status: 'skipped', completedAt: Date.now() });
        }
        ctx.results.set(stepDef.id, { status: 'skipped', output: {} });
        this.broadcastRunUpdate(run.projectId, run.id);
        continue;
      }

      // Update current step
      this.runRepo.update(run.id, { currentStepId: stepDef.id });

      const result = await this.executeStep(stepDef, ctx, run.id);
      ctx.results.set(stepDef.id, result);

      if (result.status === 'failed') {
        const onError = stepDef.onError ?? 'abort';
        if (onError === 'abort') {
          this.runRepo.update(run.id, {
            status: 'failed',
            error: result.error ?? `Step "${stepDef.name}" failed`,
            completedAt: Date.now(),
            currentStepId: undefined,
          });
          this.broadcastRunUpdate(run.projectId, run.id);
          return;
        }
        // skip: continue to next step (already recorded as failed)
      }
    }

    // All steps completed
    this.runRepo.update(run.id, {
      status: 'completed',
      completedAt: Date.now(),
      currentStepId: undefined,
    });
    this.broadcastRunUpdate(run.projectId, run.id);
  }

  private async executeStep(
    stepDef: WorkflowStepDef,
    ctx: ExecutionContext,
    runId: string,
  ): Promise<StepResult> {
    const stepRun = this.stepRunRepo.findByRunAndStep(runId, stepDef.id);
    if (!stepRun) {
      return { status: 'failed', output: {}, error: 'Step run record not found' };
    }

    const maxAttempts = stepDef.onError === 'retry' ? (stepDef.retryCount ?? 1) + 1 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.stepRunRepo.update(stepRun.id, {
        status: 'running',
        startedAt: Date.now(),
        attempt,
      });
      this.broadcastRunUpdate(ctx.projectId, runId);

      try {
        const resolvedConfig = this.resolveConfig(stepDef.config, ctx.results);
        this.stepRunRepo.update(stepRun.id, { input: resolvedConfig });

        const result = await this.executeStepHandler(stepDef, resolvedConfig, ctx, stepRun.id);

        if (result.status === 'completed') {
          this.stepRunRepo.update(stepRun.id, {
            status: 'completed',
            output: result.output,
            completedAt: Date.now(),
          });
          this.broadcastRunUpdate(ctx.projectId, runId);
          return result;
        }

        // Failed — retry if possible
        if (attempt === maxAttempts) {
          this.stepRunRepo.update(stepRun.id, {
            status: stepDef.onError === 'skip' ? 'skipped' : 'failed',
            error: result.error,
            completedAt: Date.now(),
          });
          this.broadcastRunUpdate(ctx.projectId, runId);
          return result;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (attempt === maxAttempts) {
          this.stepRunRepo.update(stepRun.id, {
            status: stepDef.onError === 'skip' ? 'skipped' : 'failed',
            error: errorMsg,
            completedAt: Date.now(),
          });
          this.broadcastRunUpdate(ctx.projectId, runId);
          return { status: 'failed', output: {}, error: errorMsg };
        }
      }
    }

    return { status: 'failed', output: {}, error: 'Exhausted retries' };
  }

  // ── Step Handlers ───────────────────────────────────────────────

  private async executeStepHandler(
    stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
    stepRunId: string,
  ): Promise<StepResult> {
    const timeoutMs = stepDef.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;

    const handler = this.getHandler(stepDef.type);
    if (!handler) {
      return { status: 'failed', output: {}, error: `Unknown step type: ${stepDef.type}` };
    }

    // Wrap in timeout
    return Promise.race([
      handler.call(this, stepDef, config, ctx, stepRunId),
      new Promise<StepResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  private getHandler(type: string): ((
    stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
    stepRunId: string,
  ) => Promise<StepResult>) | null {
    type StepHandler = (
      stepDef: WorkflowStepDef,
      config: Record<string, unknown>,
      ctx: ExecutionContext,
      stepRunId: string,
    ) => Promise<StepResult>;

    const handlers: Record<string, StepHandler> = {
      shell: this.handleShell.bind(this),
      webhook: this.handleWebhook.bind(this),
      notify: this.handleNotify.bind(this),
      condition: this.handleCondition.bind(this),
      wait: this.handleWait.bind(this),
      ai_prompt: this.handleAIPrompt.bind(this),
      ai_review: this.handleAIReview.bind(this),
      git_commit: this.handleGitCommit.bind(this),
      git_merge: this.handleGitMerge.bind(this),
      create_worktree: this.handleCreateWorktree.bind(this),
      create_pr: this.handleCreatePR.bind(this),
    };

    // Check built-in handlers first
    if (handlers[type]) return handlers[type];

    // Fall back to plugin step registry
    if (workflowStepRegistry.has(type)) {
      return async (_stepDef, config, ctx, stepRunId) => {
        const result = await workflowStepRegistry.execute(type, config, {
          projectId: ctx.projectId,
          projectRootPath: ctx.projectRootPath,
          providerId: ctx.providerId,
          stepRunId,
          runId: ctx.run.id,
        });
        return result;
      };
    }

    return null;
  }

  // ── Shell ─────────────────────────────────────────────────────

  private async handleShell(
    _stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<StepResult> {
    const command = config.command as string;
    if (!command) return { status: 'failed', output: {}, error: 'No command specified' };

    const cwd = (config.cwd as string) ?? ctx.projectRootPath ?? process.cwd();
    const timeout = (config.timeoutMs as number) ?? 60000;

    try {
      const { stdout, stderr } = await execFileAsync(
        '/bin/sh',
        ['-c', command],
        { cwd, timeout, maxBuffer: 1024 * 1024 },
      );
      return {
        status: 'completed',
        output: { stdout: stdout.trim(), stderr: stderr.trim(), exitCode: 0 },
      };
    } catch (err: any) {
      if (err.code === undefined && err.killed) {
        return { status: 'failed', output: {}, error: 'Command timed out' };
      }
      return {
        status: 'failed',
        output: { stdout: err.stdout ?? '', stderr: err.stderr ?? '', exitCode: err.code ?? 1 },
        error: err.stderr || err.message,
      };
    }
  }

  // ── Webhook ───────────────────────────────────────────────────

  private async handleWebhook(
    _stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
  ): Promise<StepResult> {
    const url = config.url as string;
    if (!url) return { status: 'failed', output: {}, error: 'No URL specified' };

    const method = (config.method as string) ?? 'POST';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...(config.headers as Record<string, string> ?? {}),
    };

    const response = await fetch(url, {
      method,
      headers,
      body: method !== 'GET' ? (config.body as string) ?? undefined : undefined,
    });

    const body = await response.text();
    return {
      status: response.ok ? 'completed' : 'failed',
      output: { statusCode: response.status, body: body.slice(0, 2000) },
      error: response.ok ? undefined : `HTTP ${response.status}`,
    };
  }

  // ── Notify ────────────────────────────────────────────────────

  private async handleNotify(
    _stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
  ): Promise<StepResult> {
    const message = config.message as string ?? 'Workflow notification';
    const notifyType = config.type as string ?? 'system';

    if (notifyType === 'webhook' && config.url) {
      const response = await fetch(config.url as string, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      });
      return {
        status: 'completed',
        output: { sent: true, type: 'webhook', statusCode: response.status },
      };
    }

    // System notification — just log and broadcast
    console.log(`[Workflow] Notification: ${message}`);
    return { status: 'completed', output: { sent: true, type: 'system', message } };
  }

  // ── Condition ─────────────────────────────────────────────────

  private async handleCondition(
    stepDef: WorkflowStepDef,
    _config: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<StepResult> {
    if (!stepDef.condition) {
      return { status: 'failed', output: {}, error: 'No condition defined' };
    }

    const conditionResult = this.evaluateCondition(stepDef.condition.expression, ctx.results);

    // Mark non-matching branch steps as skipped
    const skipSteps = conditionResult ? stepDef.condition.elseSteps : stepDef.condition.thenSteps;
    for (const stepId of skipSteps) {
      ctx.skippedByCondition.add(stepId);
    }

    return {
      status: 'completed',
      output: { conditionResult },
    };
  }

  // ── Wait / Approval ───────────────────────────────────────────

  private async handleWait(
    stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    _ctx: ExecutionContext,
    stepRunId: string,
  ): Promise<StepResult> {
    const waitType = config.type as string ?? 'timeout';

    if (waitType === 'timeout') {
      const waitMs = (config.timeoutMs as number) ?? 5000;
      await new Promise(r => setTimeout(r, waitMs));
      return { status: 'completed', output: { waited: true, durationMs: waitMs } };
    }

    // Approval flow
    const approvalTimeoutMs = stepDef.timeoutMs ?? 3600000; // 1 hour default

    // Update step run status to 'waiting'
    this.stepRunRepo.update(stepRunId, { status: 'waiting' });

    return new Promise<StepResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(stepRunId);
        resolve({ status: 'failed', output: { approved: false }, error: 'Approval timed out' });
      }, approvalTimeoutMs);

      this.pendingApprovals.set(stepRunId, {
        resolve: (approved: boolean) => {
          clearTimeout(timeout);
          this.pendingApprovals.delete(stepRunId);
          resolve({
            status: approved ? 'completed' : 'failed',
            output: { approved },
            error: approved ? undefined : 'Approval rejected',
          });
        },
        timeout,
      });
    });
  }

  // ── AI Prompt ─────────────────────────────────────────────────

  private async handleAIPrompt(
    stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
    stepRunId: string,
  ): Promise<StepResult> {
    const prompt = config.prompt as string;
    if (!prompt) return { status: 'failed', output: {}, error: 'No prompt specified' };

    const providerId = (config.providerId as string) ?? ctx.providerId;
    if (!providerId) return { status: 'failed', output: {}, error: 'No provider configured' };

    const workingDirectory = (config.workingDirectory as string) ?? ctx.projectRootPath;

    const session = this.sessionRepo.create({
      projectId: ctx.projectId,
      name: (config.sessionName as string) ?? `Workflow: ${stepDef.name}`,
      type: 'background',
      projectRole: 'workflow',
      workingDirectory,
      providerId,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    this.stepRunRepo.update(stepRunId, { sessionId: session.id });

    return new Promise<StepResult>((resolve, reject) => {
      const timeoutMs = stepDef.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        reject(new Error(`AI prompt timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const clientId = `workflow_${ctx.run.id}_${stepDef.id}_${Date.now()}`;
      createVirtualClient(clientId, {
        send: (msg: ServerMessage) => {
          if (msg.type === 'run_completed') {
            clearTimeout(timeout);
            resolve({
              status: 'completed',
              output: { sessionId: session.id, result: 'Prompt completed' },
            });
          } else if (msg.type === 'run_failed') {
            clearTimeout(timeout);
            resolve({
              status: 'failed',
              output: { sessionId: session.id },
              error: (msg as any).error ?? 'AI prompt failed',
            });
          }
        },
      });

      handleRunStart(
        { id: clientId, authenticated: true, ws: { send: () => {} } } as any,
        {
          type: 'run_start',
          clientRequestId: clientId,
          sessionId: session.id,
          input: prompt,
          workingDirectory,
          providerId,
        },
        this.db as any,
      );
    });
  }

  // ── AI Review ─────────────────────────────────────────────────

  private async handleAIReview(
    stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
    stepRunId: string,
  ): Promise<StepResult> {
    const providerId = (config.providerId as string) ?? ctx.providerId;
    if (!providerId) return { status: 'failed', output: {}, error: 'No provider configured' };

    const worktreePath = (config.worktreePath as string) ?? ctx.projectRootPath;
    const passMarker = (config.passMarker as string) ?? '[REVIEW_PASSED]';
    const failMarker = (config.failMarker as string) ?? '[REVIEW_FAILED]';

    const reviewPrompt = `You are a code reviewer. Review the changes in this working directory.
Run "git diff HEAD~1" to see the latest changes. Analyze the code for:
1. Bugs and logic errors
2. Security vulnerabilities
3. Code quality issues
4. Missing error handling

If the code is acceptable, include ${passMarker} in your response.
If there are critical issues, include ${failMarker} in your response and list the issues.`;

    const session = this.sessionRepo.create({
      projectId: ctx.projectId,
      name: `Workflow Review: ${stepDef.name}`,
      type: 'background',
      projectRole: 'workflow',
      workingDirectory: worktreePath,
      providerId,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    this.stepRunRepo.update(stepRunId, { sessionId: session.id });

    return new Promise<StepResult>((resolve, reject) => {
      const timeoutMs = stepDef.timeoutMs ?? 30 * 60 * 1000; // 30min default for reviews
      const timeout = setTimeout(() => {
        reject(new Error(`AI review timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const clientId = `workflow_review_${ctx.run.id}_${stepDef.id}_${Date.now()}`;
      createVirtualClient(clientId, {
        send: (msg: ServerMessage) => {
          if (msg.type === 'run_completed') {
            clearTimeout(timeout);
            // Check session messages for review result
            const messages = this.db.prepare(
              "SELECT content FROM messages WHERE session_id = ? AND role = 'assistant' ORDER BY created_at DESC LIMIT 5"
            ).all(session.id) as { content: string }[];

            const allContent = messages.map(m => m.content).join('\n');
            const passed = allContent.includes(passMarker);
            const failed = allContent.includes(failMarker);

            resolve({
              status: 'completed',
              output: {
                reviewPassed: passed && !failed,
                reviewNotes: allContent.slice(0, 2000),
                sessionId: session.id,
              },
            });
          } else if (msg.type === 'run_failed') {
            clearTimeout(timeout);
            resolve({
              status: 'failed',
              output: { sessionId: session.id },
              error: (msg as any).error ?? 'AI review failed',
            });
          }
        },
      });

      handleRunStart(
        { id: clientId, authenticated: true, ws: { send: () => {} } } as any,
        {
          type: 'run_start',
          clientRequestId: clientId,
          sessionId: session.id,
          input: reviewPrompt,
          workingDirectory: worktreePath,
          providerId,
        },
        this.db as any,
      );
    });
  }

  // ── Git Commit ────────────────────────────────────────────────

  private async handleGitCommit(
    _stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<StepResult> {
    const cwd = (config.worktreePath as string) ?? ctx.projectRootPath;
    if (!cwd) return { status: 'failed', output: {}, error: 'No working directory' };

    try {
      // Check for changes
      const { stdout: status } = await execFileAsync('git', ['status', '--porcelain'], { cwd });
      if (!status.trim()) {
        return { status: 'completed', output: { commitSha: null, message: 'No changes to commit' } };
      }

      // Stage all changes
      await execFileAsync('git', ['add', '-A'], { cwd });

      // Generate commit message from diff stat
      const { stdout: diffStat } = await execFileAsync('git', ['diff', '--cached', '--stat'], { cwd });
      const message = (config.message as string) ?? `auto: ${diffStat.trim().split('\n').pop() ?? 'changes'}`;

      // Commit
      await execFileAsync('git', ['commit', '-m', message], { cwd });

      // Get commit SHA
      const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });

      return {
        status: 'completed',
        output: { commitSha: sha.trim(), message },
      };
    } catch (err: any) {
      return { status: 'failed', output: {}, error: err.message };
    }
  }

  // ── Git Merge ─────────────────────────────────────────────────

  private async handleGitMerge(
    _stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<StepResult> {
    const branch = config.branch as string;
    if (!branch) return { status: 'failed', output: {}, error: 'No branch specified' };

    const baseBranch = (config.baseBranch as string) ?? 'main';
    const cwd = (config.worktreePath as string) ?? ctx.projectRootPath;
    if (!cwd) return { status: 'failed', output: {}, error: 'No working directory' };

    try {
      await execFileAsync('git', ['checkout', baseBranch], { cwd });
      await execFileAsync('git', ['merge', branch, '--no-ff', '-m', `Merge branch '${branch}'`], { cwd });

      return { status: 'completed', output: { success: true, branch, baseBranch } };
    } catch (err: any) {
      // Check for merge conflicts
      try {
        const { stdout } = await execFileAsync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd });
        if (stdout.trim()) {
          await execFileAsync('git', ['merge', '--abort'], { cwd });
          return {
            status: 'failed',
            output: { success: false, conflicts: stdout.trim().split('\n') },
            error: 'Merge conflicts detected',
          };
        }
      } catch { /* ignore */ }
      return { status: 'failed', output: {}, error: err.message };
    }
  }

  // ── Create Worktree ───────────────────────────────────────────

  private async handleCreateWorktree(
    _stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<StepResult> {
    const branchName = config.branchName as string;
    if (!branchName) return { status: 'failed', output: {}, error: 'No branch name specified' };

    const cwd = ctx.projectRootPath;
    if (!cwd) return { status: 'failed', output: {}, error: 'No project root path' };

    const baseBranch = (config.baseBranch as string) ?? 'main';
    const worktreePath = `${cwd}/../${branchName}`;

    try {
      await execFileAsync('git', ['worktree', 'add', '-b', branchName, worktreePath, baseBranch], { cwd });
      return {
        status: 'completed',
        output: { worktreePath, branch: branchName },
      };
    } catch (err: any) {
      return { status: 'failed', output: {}, error: err.message };
    }
  }

  // ── Create PR ─────────────────────────────────────────────────

  private async handleCreatePR(
    _stepDef: WorkflowStepDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<StepResult> {
    const worktreePath = (config.worktreePath as string) ?? ctx.projectRootPath;
    if (!worktreePath) return { status: 'failed', output: {}, error: 'No working directory' };

    try {
      // Get current branch name
      const { stdout: branchName } = await execFileAsync(
        'git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: worktreePath }
      );
      const branch = branchName.trim();

      const title = (config.title as string) ?? `PR: ${branch}`;
      const description = (config.description as string) ?? '';
      const baseBranch = (config.baseBranch as string) ?? 'main';

      // Get diff summary
      const { stdout: diffStat } = await execFileAsync(
        'git', ['diff', `${baseBranch}...${branch}`, '--stat'], { cwd: worktreePath }
      );

      return {
        status: 'completed',
        output: {
          title,
          description,
          branchName: branch,
          baseBranch,
          diffSummary: diffStat.trim(),
        },
      };
    } catch (err: any) {
      return { status: 'failed', output: {}, error: err.message };
    }
  }

  // ── Variable Interpolation ────────────────────────────────────

  resolveTemplate(template: string, results: Map<string, StepResult>): string {
    // Resolve ${stepId.output.field}
    let resolved = template.replace(/\$\{(\w+)\.output\.(\w+)\}/g, (match, stepId, field) => {
      const result = results.get(stepId);
      if (!result || result.status !== 'completed') return match;
      const value = result.output[field];
      return value !== undefined ? String(value) : match;
    });

    // Resolve ${stepId.status}
    resolved = resolved.replace(/\$\{(\w+)\.status\}/g, (match, stepId) => {
      const result = results.get(stepId);
      return result ? result.status : match;
    });

    return resolved;
  }

  resolveConfig(
    config: Record<string, unknown>,
    results: Map<string, StepResult>,
  ): Record<string, unknown> {
    const serialized = JSON.stringify(config);
    const resolved = this.resolveTemplate(serialized, results);
    return JSON.parse(resolved);
  }

  // ── Condition Evaluation ──────────────────────────────────────

  evaluateCondition(expression: string, results: Map<string, StepResult>): boolean {
    const resolved = this.resolveTemplate(expression, results);

    const match = resolved.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
    if (!match) return false;

    const [, left, op, right] = match;
    const l = left.trim();
    const r = right.trim();

    return op === '==' ? l === r : l !== r;
  }

  // ── Approval API ──────────────────────────────────────────────

  approveStep(stepRunId: string): boolean {
    const pending = this.pendingApprovals.get(stepRunId);
    if (!pending) return false;
    pending.resolve(true);
    return true;
  }

  rejectStep(stepRunId: string): boolean {
    const pending = this.pendingApprovals.get(stepRunId);
    if (!pending) return false;
    pending.resolve(false);
    return true;
  }

  // ── Cancel Run ────────────────────────────────────────────────

  cancelRun(runId: string): boolean {
    const run = this.runRepo.findById(runId);
    if (!run || (run.status !== 'running' && run.status !== 'pending')) return false;

    this.runRepo.update(runId, {
      status: 'cancelled',
      completedAt: Date.now(),
    });

    // Resolve any pending approvals for this run
    const stepRuns = this.stepRunRepo.findByRun(runId);
    for (const sr of stepRuns) {
      if (this.pendingApprovals.has(sr.id)) {
        this.pendingApprovals.get(sr.id)!.resolve(false);
      }
    }

    this.broadcastRunUpdate(run.projectId, runId);
    return true;
  }

  // ── Broadcast ─────────────────────────────────────────────────

  private broadcastRunUpdate(projectId: string, runId: string): void {
    const run = this.runRepo.findById(runId);
    if (!run) return;
    const stepRuns = this.stepRunRepo.findByRun(runId);
    this.broadcastFn(projectId, {
      type: 'workflow_run_update',
      projectId,
      run,
      stepRuns,
    });
  }
}
