/**
 * Workflow Execution Engine (Graph-based)
 *
 * Owns: DAG traversal, run lifecycle, step orchestration, template resolution, approval state.
 * Delegates: step execution to injected StepExecutorPort (see step-executors/).
 */

import type {
  WorkflowNodeDef,
  WorkflowEdgeDef,
  WorkflowRun,
  WorkflowDefinition,
  ServerMessage,
} from '@my-claudia/shared';
import { WorkflowRunRepository } from './workflow-run-repository.js';
import { WorkflowStepRunRepository } from './workflow-step-run-repository.js';
import { ProjectRepository } from '../../repositories/project.js';
import { renderConfig, type RenderContext } from './template-renderer.js';
import type { StepExecutorPort, StepResult, StepContext, ApprovalPort } from './ports/step-executor.js';
import type { Database } from 'better-sqlite3';

// Re-export for backward compatibility
export type { StepResult } from './ports/step-executor.js';

export interface ExecutionContext {
  results: Map<string, StepResult>;
  run: WorkflowRun;
  projectId?: string;
  projectRootPath?: string;
  providerId?: string;
  eventPayload?: Record<string, unknown>;
  triggerContext?: Record<string, unknown>;
}

export interface RunTriggerContext {
  eventPayload?: Record<string, unknown>;
  triggerContext?: Record<string, unknown>;
}

export class WorkflowEngine implements ApprovalPort {
  private runRepo: WorkflowRunRepository;
  private stepRunRepo: WorkflowStepRunRepository;
  private projectRepo: ProjectRepository;
  private activeRuns = new Map<string, boolean>();
  private pendingApprovals = new Map<string, {
    resolve: (approved: boolean) => void;
    timeout: NodeJS.Timeout;
  }>();

  constructor(
    private db: Database,
    private broadcastFn: (projectId: string | undefined, message: ServerMessage | { type: string; [key: string]: unknown }) => void,
    private stepExecutor: StepExecutorPort,
  ) {
    this.runRepo = new WorkflowRunRepository(db);
    this.stepRunRepo = new WorkflowStepRunRepository(db);
    this.projectRepo = new ProjectRepository(db);
  }

  isRunning(workflowId: string): boolean {
    return this.activeRuns.has(workflowId);
  }

  destroy(): void {
    for (const [, pending] of this.pendingApprovals) {
      clearTimeout(pending.timeout);
      pending.resolve(false);
    }
    this.pendingApprovals.clear();
    this.activeRuns.clear();
  }

  // ── ApprovalPort implementation ──────────────────────────────

  async waitForApproval(stepRunId: string, timeoutMs: number): Promise<boolean> {
    this.stepRunRepo.update(stepRunId, { status: 'waiting' });

    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingApprovals.delete(stepRunId);
        resolve(false);
      }, timeoutMs);

      this.pendingApprovals.set(stepRunId, {
        resolve: (approved: boolean) => {
          clearTimeout(timeout);
          this.pendingApprovals.delete(stepRunId);
          resolve(approved);
        },
        timeout,
      });
    });
  }

  // ── DAG Validation ───────────────────────────────────────────

  validateDAG(nodes: WorkflowNodeDef[], edges: WorkflowEdgeDef[]): { valid: boolean; error?: string } {
    const nodeIds = new Set(nodes.map(n => n.id));

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

  // ── Graph Traversal Helpers ──────────────────────────────────

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

    if (nodeDef.type === 'condition') {
      const condResult = result.output.conditionResult as boolean;
      const edgeType = condResult ? 'condition_true' : 'condition_false';
      const edge = edges.find(e => e.type === edgeType);
      return edge?.target ?? null;
    }

    if (result.status === 'failed' && nodeDef.onError === 'route') {
      const errorEdge = edges.find(e => e.type === 'error');
      return errorEdge?.target ?? null;
    }

    if (result.status === 'completed' || (result.status === 'failed' && nodeDef.onError === 'skip')) {
      const nextEdge = edges.find(e => e.type === 'success') ?? edges.find(e => e.type === 'loop');
      return nextEdge?.target ?? null;
    }

    return null;
  }

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
    projectId: string | undefined,
    definition: WorkflowDefinition,
    triggerSource: 'manual' | 'schedule' | 'event',
    triggerDetail?: string,
    triggerData?: RunTriggerContext,
  ): Promise<WorkflowRun> {
    if (this.activeRuns.has(workflowId)) {
      throw new Error(`Workflow ${workflowId} is already running`);
    }

    const validation = this.validateDAG(definition.nodes, definition.edges);
    if (!validation.valid) {
      throw new Error(`Invalid workflow graph: ${validation.error}`);
    }

    const project = projectId ? this.projectRepo.findById(projectId) : null;

    const run = this.runRepo.create({
      workflowId,
      projectId,
      status: 'running',
      triggerSource,
      triggerDetail,
      startedAt: Date.now(),
    });

    for (const node of definition.nodes) {
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

    this.executeGraph(run, definition, project?.rootPath, project?.providerId, triggerData)
      .catch((err) => {
        console.error(`[Workflow] Run ${run.id} failed:`, err);
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
    definition: WorkflowDefinition,
    projectRootPath?: string,
    providerId?: string,
    triggerData?: RunTriggerContext,
  ): Promise<void> {
    const ctx: ExecutionContext = {
      results: new Map(),
      run,
      projectId: run.projectId,
      projectRootPath,
      providerId,
      eventPayload: triggerData?.eventPayload,
      triggerContext: triggerData?.triggerContext,
    };

    const nodeMap = new Map(definition.nodes.map(n => [n.id, n]));
    const adjacency = this.buildAdjacencyMap(definition.edges);
    const visitCounts = new Map<string, number>();
    let previousNodeId: string | null = null;

    let currentNodeId: string | null = definition.entryNodeId;

    while (currentNodeId) {
      const currentRun = this.runRepo.findById(run.id);
      if (!currentRun || currentRun.status === 'cancelled') {
        return;
      }

      const currentVisits = visitCounts.get(currentNodeId) ?? 0;
      const maxAllowedVisits = this.getMaxVisitsForNode(currentNodeId, previousNodeId, adjacency);
      if (currentVisits >= maxAllowedVisits) {
        if (maxAllowedVisits > 1 && previousNodeId) {
          const exhaustedEdge = (adjacency.get(previousNodeId) ?? [])
            .find(e => e.type === 'loop_exhausted');
          if (exhaustedEdge) {
            previousNodeId = currentNodeId;
            currentNodeId = exhaustedEdge.target;
            continue;
          }
        }
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

      this.runRepo.update(run.id, { currentStepId: nodeDef.id });

      const result = await this.executeStep(nodeDef, ctx, run.id);
      ctx.results.set(nodeDef.id, result);

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

      previousNodeId = currentNodeId;
      currentNodeId = this.findNextNodeId(nodeDef.id, result, adjacency, nodeDef);
    }

    for (const node of definition.nodes) {
      if (!visitCounts.has(node.id)) {
        const stepRun = this.stepRunRepo.findByRunAndStep(run.id, node.id);
        if (stepRun && stepRun.status === 'pending') {
          this.stepRunRepo.update(stepRun.id, { status: 'skipped', completedAt: Date.now() });
        }
      }
    }

    this.runRepo.update(run.id, {
      status: 'completed',
      completedAt: Date.now(),
      currentStepId: undefined,
    });
    this.broadcastRunUpdate(run.projectId, run.id);
  }

  // ── Step Execution (delegates to StepExecutorPort) ──────────

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
        const resolvedConfig = this.resolveConfig(nodeDef.config, ctx.results, ctx);
        this.stepRunRepo.update(stepRun.id, { input: resolvedConfig });

        const stepCtx: StepContext = {
          runId,
          stepRunId: stepRun.id,
          projectId: ctx.projectId,
          projectRootPath: ctx.projectRootPath,
          providerId: ctx.providerId,
          results: ctx.results,
          eventPayload: ctx.eventPayload,
          triggerContext: ctx.triggerContext,
          resolveTemplate: (template: string) => this.resolveTemplate(template, ctx.results),
          setSessionId: (sessionId: string) => {
            this.stepRunRepo.update(stepRun.id, { sessionId });
            this.broadcastRunUpdate(ctx.projectId, runId);
          },
        };

        const result = await this.stepExecutor.execute(nodeDef, resolvedConfig, stepCtx);

        if (result.status === 'completed') {
          this.stepRunRepo.update(stepRun.id, {
            status: 'completed',
            output: result.output,
            completedAt: Date.now(),
          });
          this.broadcastRunUpdate(ctx.projectId, runId);
          return result;
        }

        if (attempt === maxAttempts) {
          const failStatus = nodeDef.onError === 'skip' ? 'skipped' : 'failed';
          this.stepRunRepo.update(stepRun.id, {
            status: failStatus as 'failed' | 'skipped',
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
            status: failStatus as 'failed' | 'skipped',
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

  // ── Variable Interpolation ────────────────────────────────────

  resolveTemplate(template: string, results: Map<string, StepResult>): string {
    const now = new Date();
    let resolved = template
      .replace(/\$\{date\}/g, now.toISOString().slice(0, 10))
      .replace(/\$\{timestamp\}/g, String(now.getTime()));

    resolved = resolved.replace(/\$\{(\w+)\.output\.(\w+)\}/g, (match, stepId, field) => {
      const result = results.get(stepId);
      if (!result || result.status !== 'completed') return match;
      const value = result.output[field];
      return value !== undefined ? String(value) : match;
    });

    resolved = resolved.replace(/\$\{(\w+)\.status\}/g, (match, stepId) => {
      const result = results.get(stepId);
      return result ? result.status : match;
    });

    return resolved;
  }

  resolveConfig(
    config: Record<string, unknown>,
    results: Map<string, StepResult>,
    ctx?: ExecutionContext,
  ): Record<string, unknown> {
    const resolvedLegacy = this.deepResolveTemplate(config, results);

    const stepsOutput: Record<string, Record<string, unknown>> = {};
    for (const [nodeId, result] of results) {
      stepsOutput[nodeId] = { status: result.status, ...result.output };
    }
    const renderCtx: RenderContext = {
      event: ctx?.eventPayload,
      trigger: ctx?.triggerContext,
      steps: stepsOutput,
      workflow: ctx ? { id: ctx.run.workflowId, projectId: ctx.projectId } : undefined,
    };
    return renderConfig(resolvedLegacy, renderCtx);
  }

  private deepResolveTemplate(
    obj: Record<string, unknown>,
    results: Map<string, StepResult>,
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'string') {
        result[key] = this.resolveTemplate(value, results);
      } else if (value != null && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.deepResolveTemplate(value as Record<string, unknown>, results);
      } else if (Array.isArray(value)) {
        result[key] = value.map(item =>
          typeof item === 'string' ? this.resolveTemplate(item, results)
          : item != null && typeof item === 'object' && !Array.isArray(item)
            ? this.deepResolveTemplate(item as Record<string, unknown>, results)
            : item
        );
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  evaluateCondition(expression: string, results: Map<string, StepResult>): boolean {
    const resolved = this.resolveTemplate(expression, results);
    const match = resolved.match(/^(.+?)\s*(==|!=)\s*(.+)$/);
    if (!match) return false;
    const [, left, op, right] = match;
    return op === '==' ? left.trim() === right.trim() : left.trim() !== right.trim();
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

  private broadcastRunUpdate(projectId: string | undefined, runId: string): void {
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
