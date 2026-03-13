/**
 * Workflow Execution Engine (V2 — Graph-based)
 *
 * Executes workflow nodes by traversing a DAG with support for:
 * - Variable interpolation: ${stepId.output.field}
 * - Condition branches: condition_true / condition_false edges
 * - Error routing: onError='route' follows error edges
 * - Error handling: abort/skip/retry/route
 * - Async AI steps via virtual client pattern
 * - Wait/approval steps with external resolution
 */

import type { Database } from 'better-sqlite3';
import type {
  WorkflowNodeDef,
  WorkflowEdgeDef,
  WorkflowStepRun,
  WorkflowRun,
  WorkflowDefinition,
  WorkflowDefinitionV2,
  ServerMessage,
  Session,
} from '@my-claudia/shared';
import { isV2Definition, migrateV1ToV2 } from '@my-claudia/shared';
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
    private notificationService?: { notify(event: { type: string; title: string; body: string; priority?: string; tags?: string[] }): Promise<void> },
  ) {
    this.runRepo = new WorkflowRunRepository(db);
    this.stepRunRepo = new WorkflowStepRunRepository(db);
    this.projectRepo = new ProjectRepository(db);
    this.sessionRepo = new SessionRepository(db);
  }

  isRunning(workflowId: string): boolean {
    return this.activeRuns.has(workflowId);
  }

  // ── DAG Validation ───────────────────────────────────────────

  validateDAG(nodes: WorkflowNodeDef[], edges: WorkflowEdgeDef[]): { valid: boolean; error?: string } {
    const nodeIds = new Set(nodes.map(n => n.id));

    // Check edges reference valid nodes
    for (const edge of edges) {
      if (!nodeIds.has(edge.source)) {
        return { valid: false, error: `Edge "${edge.id}" references unknown source node "${edge.source}"` };
      }
      if (!nodeIds.has(edge.target)) {
        return { valid: false, error: `Edge "${edge.id}" references unknown target node "${edge.target}"` };
      }
      if (edge.source === edge.target) {
        return { valid: false, error: `Edge "${edge.id}" is a self-loop on node "${edge.source}"` };
      }
    }

    // Topological sort to detect cycles (Kahn's algorithm)
    // Exclude loop/loop_exhausted edges — they intentionally create cycles
    const nonLoopEdges = edges.filter(e => e.type !== 'loop' && e.type !== 'loop_exhausted');
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const id of nodeIds) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }
    for (const edge of nonLoopEdges) {
      adj.get(edge.source)!.push(edge.target);
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    let visited = 0;
    while (queue.length > 0) {
      const node = queue.shift()!;
      visited++;
      for (const neighbor of adj.get(node) ?? []) {
        const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
        inDegree.set(neighbor, newDeg);
        if (newDeg === 0) queue.push(neighbor);
      }
    }

    if (visited !== nodeIds.size) {
      return { valid: false, error: 'Workflow graph contains a cycle' };
    }

    return { valid: true };
  }

  // ── Adjacency Map ────────────────────────────────────────────

  private buildAdjacencyMap(edges: WorkflowEdgeDef[]): Map<string, WorkflowEdgeDef[]> {
    const map = new Map<string, WorkflowEdgeDef[]>();
    for (const edge of edges) {
      if (!map.has(edge.source)) map.set(edge.source, []);
      map.get(edge.source)!.push(edge);
    }
    return map;
  }

  private findNextNodeId(
    currentNodeId: string,
    result: StepResult,
    adjacency: Map<string, WorkflowEdgeDef[]>,
    nodeDef: WorkflowNodeDef,
  ): string | null {
    const edges = adjacency.get(currentNodeId) ?? [];

    // Condition node: follow condition_true or condition_false
    if (nodeDef.type === 'condition') {
      const condResult = result.output.conditionResult as boolean;
      const edgeType = condResult ? 'condition_true' : 'condition_false';
      const edge = edges.find(e => e.type === edgeType);
      return edge?.target ?? null;
    }

    // Failed node with onError == 'route': follow error edge
    if (result.status === 'failed' && nodeDef.onError === 'route') {
      const errorEdge = edges.find(e => e.type === 'error');
      return errorEdge?.target ?? null;
    }

    // Normal success or skip: follow success edge, then loop edge as fallback
    if (result.status === 'completed' || (result.status === 'failed' && nodeDef.onError === 'skip')) {
      const nextEdge = edges.find(e => e.type === 'success') ?? edges.find(e => e.type === 'loop');
      return nextEdge?.target ?? null;
    }

    return null;
  }

  // ── Loop Support ────────────────────────────────────────────────

  private getMaxVisitsForNode(
    targetNodeId: string,
    sourceNodeId: string | null,
    adjacency: Map<string, WorkflowEdgeDef[]>,
  ): number {
    if (!sourceNodeId) return 1;
    const edges = adjacency.get(sourceNodeId) ?? [];
    const loopEdge = edges.find(e => e.target === targetNodeId && e.type === 'loop');
    return loopEdge ? (loopEdge.maxIterations ?? 3) : 1;
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

    // Normalize to V2
    const defV2 = isV2Definition(definition) ? definition : migrateV1ToV2(definition);

    // Validate DAG
    const validation = this.validateDAG(defV2.nodes, defV2.edges);
    if (!validation.valid) {
      throw new Error(`Invalid workflow graph: ${validation.error}`);
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

    // Create step run records for all nodes
    for (const node of defV2.nodes) {
      this.stepRunRepo.create({
        runId: run.id,
        stepId: node.id,
        stepType: node.type,
        status: 'pending',
        attempt: 1,
      });
    }

    this.broadcastRunUpdate(projectId, run.id);
    this.activeRuns.set(workflowId, true);

    // Execute asynchronously
    this.executeGraph(run, defV2, project?.rootPath, project?.providerId)
      .catch((err) => {
        console.error(`[Workflow] Run ${run.id} failed:`, err);
        // Ensure run is marked as failed if executeGraph throws
        const currentRun = this.runRepo.findById(run.id);
        if (currentRun && currentRun.status === 'running') {
          this.runRepo.update(run.id, {
            status: 'failed',
            error: err.message,
            completedAt: Date.now(),
            currentStepId: undefined,
          });
          this.broadcastRunUpdate(projectId, run.id);
        }
      })
      .finally(() => {
        this.activeRuns.delete(workflowId);
      });

    return run;
  }

  private async executeGraph(
    run: WorkflowRun,
    definition: WorkflowDefinitionV2,
    projectRootPath?: string,
    providerId?: string,
  ): Promise<void> {
    const ctx: ExecutionContext = {
      results: new Map(),
      run,
      projectId: run.projectId,
      projectRootPath,
      providerId,
    };

    const nodeMap = new Map(definition.nodes.map(n => [n.id, n]));
    const adjacency = this.buildAdjacencyMap(definition.edges);
    const visitCounts = new Map<string, number>();
    let previousNodeId: string | null = null;

    let currentNodeId: string | null = definition.entryNodeId;

    while (currentNodeId) {
      // Check if run was cancelled
      const currentRun = this.runRepo.findById(run.id);
      if (!currentRun || currentRun.status === 'cancelled') {
        return;
      }

      // Loop-aware cycle detection
      const currentVisits = visitCounts.get(currentNodeId) ?? 0;
      const maxAllowedVisits = this.getMaxVisitsForNode(currentNodeId, previousNodeId, adjacency);
      if (currentVisits >= maxAllowedVisits) {
        if (maxAllowedVisits > 1 && previousNodeId) {
          // Loop exhausted — follow loop_exhausted edge if exists
          const exhaustedEdge = (adjacency.get(previousNodeId) ?? [])
            .find(e => e.type === 'loop_exhausted');
          if (exhaustedEdge) {
            previousNodeId = currentNodeId;
            currentNodeId = exhaustedEdge.target;
            continue;
          }
        }
        // Real cycle or no exhausted edge — fail
        this.runRepo.update(run.id, {
          status: 'failed',
          error: `Cycle detected at node "${currentNodeId}"`,
          completedAt: Date.now(),
          currentStepId: undefined,
        });
        this.broadcastRunUpdate(run.projectId, run.id);
        return;
      }
      visitCounts.set(currentNodeId, currentVisits + 1);

      const nodeDef = nodeMap.get(currentNodeId);
      if (!nodeDef) {
        this.runRepo.update(run.id, {
          status: 'failed',
          error: `Node "${currentNodeId}" not found in workflow definition`,
          completedAt: Date.now(),
          currentStepId: undefined,
        });
        this.broadcastRunUpdate(run.projectId, run.id);
        return;
      }

      // Update current step
      this.runRepo.update(run.id, { currentStepId: nodeDef.id });

      const result = await this.executeStep(nodeDef, ctx, run.id);
      ctx.results.set(nodeDef.id, result);

      // Handle abort on failure
      if (result.status === 'failed') {
        const onError = nodeDef.onError ?? 'abort';
        if (onError === 'abort') {
          this.runRepo.update(run.id, {
            status: 'failed',
            error: result.error ?? `Node "${nodeDef.name}" failed`,
            completedAt: Date.now(),
            currentStepId: undefined,
          });
          this.broadcastRunUpdate(run.projectId, run.id);
          return;
        }
      }

      // Determine next node via edges
      previousNodeId = currentNodeId;
      currentNodeId = this.findNextNodeId(nodeDef.id, result, adjacency, nodeDef);
    }

    // Mark unvisited nodes as skipped
    for (const node of definition.nodes) {
      if (!visitCounts.has(node.id)) {
        const stepRun = this.stepRunRepo.findByRunAndStep(run.id, node.id);
        if (stepRun && stepRun.status === 'pending') {
          this.stepRunRepo.update(stepRun.id, { status: 'skipped', completedAt: Date.now() });
        }
      }
    }

    // Workflow complete
    this.runRepo.update(run.id, {
      status: 'completed',
      completedAt: Date.now(),
      currentStepId: undefined,
    });
    this.broadcastRunUpdate(run.projectId, run.id);
  }

  private async executeStep(
    nodeDef: WorkflowNodeDef,
    ctx: ExecutionContext,
    runId: string,
  ): Promise<StepResult> {
    const stepRun = this.stepRunRepo.findByRunAndStep(runId, nodeDef.id);
    if (!stepRun) {
      return { status: 'failed', output: {}, error: 'Step run record not found' };
    }

    const maxAttempts = nodeDef.onError === 'retry' ? (nodeDef.retryCount ?? 1) + 1 : 1;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.stepRunRepo.update(stepRun.id, {
        status: 'running',
        startedAt: Date.now(),
        attempt,
      });
      this.broadcastRunUpdate(ctx.projectId, runId);

      try {
        const resolvedConfig = this.resolveConfig(nodeDef.config, ctx.results);
        this.stepRunRepo.update(stepRun.id, { input: resolvedConfig });

        const result = await this.executeStepHandler(nodeDef, resolvedConfig, ctx, stepRun.id);

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
          const failStatus = nodeDef.onError === 'skip' ? 'skipped' : 'failed';
          this.stepRunRepo.update(stepRun.id, {
            status: failStatus as any,
            error: result.error,
            completedAt: Date.now(),
          });
          this.broadcastRunUpdate(ctx.projectId, runId);
          return result;
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (attempt === maxAttempts) {
          const failStatus = nodeDef.onError === 'skip' ? 'skipped' : 'failed';
          this.stepRunRepo.update(stepRun.id, {
            status: failStatus as any,
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
    nodeDef: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
    stepRunId: string,
  ): Promise<StepResult> {
    const timeoutMs = nodeDef.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;

    const handler = this.getHandler(nodeDef.type);
    if (!handler) {
      return { status: 'failed', output: {}, error: `Unknown step type: ${nodeDef.type}` };
    }

    // Wrap in timeout
    return Promise.race([
      handler.call(this, nodeDef, config, ctx, stepRunId),
      new Promise<StepResult>((_, reject) =>
        setTimeout(() => reject(new Error(`Step timed out after ${timeoutMs}ms`)), timeoutMs)
      ),
    ]);
  }

  private getHandler(type: string): ((
    nodeDef: WorkflowNodeDef,
    config: Record<string, unknown>,
    ctx: ExecutionContext,
    stepRunId: string,
  ) => Promise<StepResult>) | null {
    type StepHandler = (
      nodeDef: WorkflowNodeDef,
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
      return async (_nodeDef, config, ctx, stepRunId) => {
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
    _nodeDef: WorkflowNodeDef,
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
    _nodeDef: WorkflowNodeDef,
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
    _nodeDef: WorkflowNodeDef,
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

    // System notification — push via ntfy + broadcast to frontend
    if (this.notificationService) {
      await this.notificationService.notify({
        type: 'run_completed',
        title: (config.title as string) ?? 'Workflow',
        body: message,
        priority: (config.priority as string) ?? 'default',
        tags: (config.tags as string[]) ?? ['wrench'],
      });
    }

    console.log(`[Workflow] Notification: ${message}`);
    return { status: 'completed', output: { sent: true, type: 'system', message } };
  }

  // ── Condition ─────────────────────────────────────────────────
  // In V2, condition branching is handled by edges (condition_true/condition_false).
  // The handler only needs to evaluate the expression and return the result.

  private async handleCondition(
    nodeDef: WorkflowNodeDef,
    _config: Record<string, unknown>,
    ctx: ExecutionContext,
  ): Promise<StepResult> {
    if (!nodeDef.condition) {
      return { status: 'failed', output: {}, error: 'No condition defined' };
    }

    const conditionResult = this.evaluateCondition(nodeDef.condition.expression, ctx.results);

    return {
      status: 'completed',
      output: { conditionResult },
    };
  }

  // ── Wait / Approval ───────────────────────────────────────────

  private async handleWait(
    nodeDef: WorkflowNodeDef,
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
    const approvalTimeoutMs = nodeDef.timeoutMs ?? 3600000; // 1 hour default

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
    nodeDef: WorkflowNodeDef,
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
      name: (config.sessionName as string) ?? `Workflow: ${nodeDef.name}`,
      type: 'background',
      projectRole: 'workflow',
      workingDirectory,
      providerId,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    this.stepRunRepo.update(stepRunId, { sessionId: session.id });

    return new Promise<StepResult>((resolve, reject) => {
      const timeoutMs = nodeDef.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
      const timeout = setTimeout(() => {
        reject(new Error(`AI prompt timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const clientId = `workflow_${ctx.run.id}_${nodeDef.id}_${Date.now()}`;
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
    nodeDef: WorkflowNodeDef,
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
      name: `Workflow Review: ${nodeDef.name}`,
      type: 'background',
      projectRole: 'workflow',
      workingDirectory: worktreePath,
      providerId,
    } as Omit<Session, 'id' | 'createdAt' | 'updatedAt'>);

    this.stepRunRepo.update(stepRunId, { sessionId: session.id });

    return new Promise<StepResult>((resolve, reject) => {
      const timeoutMs = nodeDef.timeoutMs ?? 30 * 60 * 1000; // 30min default for reviews
      const timeout = setTimeout(() => {
        reject(new Error(`AI review timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const clientId = `workflow_review_${ctx.run.id}_${nodeDef.id}_${Date.now()}`;
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
    _nodeDef: WorkflowNodeDef,
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
    _nodeDef: WorkflowNodeDef,
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
    _nodeDef: WorkflowNodeDef,
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
    _nodeDef: WorkflowNodeDef,
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
    // Resolve built-in runtime variables
    const now = new Date();
    let resolved = template
      .replace(/\$\{date\}/g, now.toISOString().slice(0, 10))
      .replace(/\$\{timestamp\}/g, String(now.getTime()));

    // Resolve ${stepId.output.field}
    resolved = resolved.replace(/\$\{(\w+)\.output\.(\w+)\}/g, (match, stepId, field) => {
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
