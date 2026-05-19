// server/src/domains/meta-workflow/service.ts
import type { Database } from 'better-sqlite3';
import type {
  MetaWorkflowRun,
  MetaWorkflowPhase,
  ReusablePoolItem,
} from '@my-claudia/shared/features/meta-workflow';
import { MetaWorkflowRunRepository } from './repositories/meta-workflow-run-repository.js';
import { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
import { MetaWorkflowArtifactRepository } from './repositories/meta-workflow-artifact-repository.js';
import { MetaWorkflowReusePoolRepository } from './repositories/meta-workflow-reuse-pool-repository.js';
import { MetaSubagentTemplateRepository } from './repositories/meta-subagent-template-repository.js';
import { MetaWorkflowRunAggregate } from './run-aggregate.js';
import { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';
import { ReusePoolSearchService } from './reuse-pool-search.js';
import { ReusePoolPromotionService, type PromoteInput } from './reuse-pool-promotion.js';
import { MetaPhaseExecutor, type RunEntity, type PhaseExecutionResult } from './phase-executor.js';
import { validatePhasesJson } from './phases-json-validator.js';
import { StalePropagator } from './stale-propagator.js';
import type { AiRunPort } from './run-entities/subagent-run-entity.js';

export interface WorktreeAllocator {
  acquire(meta: { runId: string; phaseId: string; attempt: number }): Promise<string>;
  /** @deprecated kept for backwards-compat; Phase D callsites still invoke it. Use `releaseRun` instead. */
  release(path: string): Promise<void>;
  /** Release the worktree slot held for a run (idempotent). */
  releaseRun(runId: string): Promise<void>;
}

export interface MetaWorkflowServiceOptions {
  db: Database;
  runEntityForWorkflow: RunEntity;
  runEntityForSubagent: RunEntity;
  worktreeAllocator: WorktreeAllocator;
  /** Optional — used by `evaluateImpact` once Task 2 lands. Service still works without it (static fallback). */
  aiRunPort?: AiRunPort;
}

export interface CreateRunInput {
  projectId: string;
  title: string;
  description?: string;
  defaultProviderId?: string;
}

export class MetaWorkflowService {
  private runRepo: MetaWorkflowRunRepository;
  private phaseRepo: MetaWorkflowPhaseRepository;
  private artifactRepo: MetaWorkflowArtifactRepository;
  private poolRepo: MetaWorkflowReusePoolRepository;
  private subagentRepo: MetaSubagentTemplateRepository;
  private runAggregate: MetaWorkflowRunAggregate;
  private phaseAggregate: MetaWorkflowPhaseAggregate;
  private search: ReusePoolSearchService;
  private promotion: ReusePoolPromotionService;
  private propagator: StalePropagator;

  constructor(private opts: MetaWorkflowServiceOptions) {
    this.runRepo = new MetaWorkflowRunRepository(opts.db);
    this.phaseRepo = new MetaWorkflowPhaseRepository(opts.db);
    this.artifactRepo = new MetaWorkflowArtifactRepository(opts.db);
    this.poolRepo = new MetaWorkflowReusePoolRepository(opts.db);
    this.subagentRepo = new MetaSubagentTemplateRepository(opts.db);
    this.runAggregate = new MetaWorkflowRunAggregate(this.runRepo);
    this.phaseAggregate = new MetaWorkflowPhaseAggregate(this.phaseRepo);
    this.search = new ReusePoolSearchService(this.poolRepo);
    this.promotion = new ReusePoolPromotionService(this.poolRepo, this.subagentRepo);
    this.propagator = new StalePropagator({
      phaseRepo: this.phaseRepo,
      artifactRepo: this.artifactRepo,
      phaseAggregate: this.phaseAggregate,
    });
  }

  // ── Run lifecycle ───────────────────────────────────────

  createRun(input: CreateRunInput): MetaWorkflowRun {
    return this.runAggregate.create(input);
  }

  submitRequirements(runId: string, requirementsPath: string): MetaWorkflowRun {
    return this.runAggregate.submitRequirements(runId, requirementsPath);
  }

  approveRequirements(runId: string): MetaWorkflowRun {
    return this.runAggregate.approveRequirements(runId);
  }

  rejectRequirements(runId: string): MetaWorkflowRun {
    return this.runAggregate.rejectRequirements(runId);
  }

  setPhasesJson(runId: string, phasesJson: string): MetaWorkflowRun {
    const validation = validatePhasesJson(phasesJson);
    if (!validation.ok) {
      throw new Error(`Invalid phases.json: ${validation.errors.join('; ')}`);
    }
    const updated = this.runAggregate.setPhasesJson(runId, phasesJson);
    for (const phaseDef of validation.doc.phases) {
      this.phaseAggregate.instantiate(runId, phaseDef);
    }
    return updated;
  }

  cancelRun(runId: string): MetaWorkflowRun {
    return this.runAggregate.cancel(runId);
  }

  // ── Phase execution ─────────────────────────────────────

  async runPhase(runId: string, phaseId: string): Promise<PhaseExecutionResult> {
    const phase = this.phaseRepo.findByRunAndPhaseId(runId, phaseId);
    if (!phase) throw new Error(`Phase not found: run=${runId} phase=${phaseId}`);

    const run = this.runRepo.findById(runId);
    if (!run?.phasesJson) throw new Error(`Run ${runId} has no phases.json`);

    const validation = validatePhasesJson(run.phasesJson);
    if (!validation.ok) throw new Error('Run has invalid phasesJson');
    const phaseDef = validation.doc.phases.find((p) => p.id === phaseId);
    if (!phaseDef) throw new Error(`Phase def not in phases.json: ${phaseId}`);

    const worktreePath = await this.opts.worktreeAllocator.acquire({
      runId, phaseId, attempt: phase.attempt + 1,
    });
    try {
      const executor = new MetaPhaseExecutor({
        aggregate: this.phaseAggregate,
        artifactRepo: this.artifactRepo,
        runEntity: async (entity, ctx) => {
          if (entity.kind === 'workflow') return this.opts.runEntityForWorkflow(entity, ctx);
          return this.opts.runEntityForSubagent(entity, ctx);
        },
      });
      return await executor.execute(phase.id, phaseDef, worktreePath);
    } finally {
      await this.opts.worktreeAllocator.release(worktreePath);
    }
  }

  // ── Reuse pool ──────────────────────────────────────────

  promotePoolItem(itemId: string, input: PromoteInput): ReusablePoolItem {
    return this.promotion.promote(itemId, input);
  }

  searchReusePool(phaseDef: Parameters<ReusePoolSearchService['search']>[0]) {
    return this.search.search(phaseDef);
  }

  // ── Read queries (for routes/handlers) ──────────────────

  listRuns(projectId: string): MetaWorkflowRun[] {
    return this.runRepo.findByProject(projectId);
  }

  getRun(runId: string): MetaWorkflowRun | null {
    return this.runRepo.findById(runId);
  }

  listPhases(runId: string): MetaWorkflowPhase[] {
    return this.phaseRepo.findByRun(runId);
  }

  // ── Stale-action methods ────────────────────────────────

  async rerunPhase(runId: string, phaseId: string): Promise<PhaseExecutionResult> {
    const phase = this.phaseRepo.findByRunAndPhaseId(runId, phaseId);
    if (!phase) throw new Error(`Phase not found: run=${runId} phase=${phaseId}`);

    if (phase.status === 'stale' || phase.status === 'failed') {
      this.phaseAggregate.resetToPending(phase.id);
    } else if (phase.status === 'done') {
      // Phase D MVP hack: done → stale → pending, so we can reset.
      // A cleaner solution (force flag on resetToPending) lands in Phase E.
      this.phaseAggregate.markStale(phase.id, phase.phaseId);
      this.phaseAggregate.resetToPending(phase.id);
    }

    const result = await this.runPhase(runId, phaseId);

    // Propagate stale to direct downstreams after successful rerun.
    const run = this.runRepo.findById(runId);
    if (run?.phasesJson) {
      const validation = validatePhasesJson(run.phasesJson);
      if (validation.ok) {
        this.propagator.propagateUpstreamRerun(runId, phaseId, validation.doc);
      }
    }

    return result;
  }

  ignoreStale(runId: string, phaseId: string): MetaWorkflowPhase {
    const phase = this.phaseRepo.findByRunAndPhaseId(runId, phaseId);
    if (!phase) throw new Error(`Phase not found: run=${runId} phase=${phaseId}`);
    return this.phaseAggregate.clearStale(phase.id);
  }

  async evaluateImpact(
    runId: string,
    phaseId: string,
  ): Promise<{ kind: 'rerun' | 'ignore' | 'minor-fix'; reason: string }> {
    const phase = this.phaseRepo.findByRunAndPhaseId(runId, phaseId);
    if (!phase) throw new Error(`Phase not found: run=${runId} phase=${phaseId}`);

    if (!this.opts.aiRunPort) {
      return {
        kind: 'rerun',
        reason: 'No aiRunPort configured — defaulting to re-run (static fallback).',
      };
    }

    // Find upstream phase + its two latest artifacts.
    const upstreamPhaseId = phase.staleSourcePhaseId;
    if (!upstreamPhaseId) {
      return {
        kind: 'rerun',
        reason: 'No staleSourcePhaseId recorded — defaulting to re-run (static fallback).',
      };
    }
    const upstreamPhase = this.phaseRepo.findByRunAndPhaseId(runId, upstreamPhaseId);
    if (!upstreamPhase) {
      return {
        kind: 'rerun',
        reason: `Upstream phase ${upstreamPhaseId} not found — defaulting to re-run (static fallback).`,
      };
    }
    const upstreamArtifacts = this.artifactRepo.findByPhase(upstreamPhase.id);
    if (upstreamArtifacts.length < 2) {
      return {
        kind: 'rerun',
        reason: 'Upstream has fewer than 2 artifact versions — no prior to compare against (static fallback).',
      };
    }
    const currentSha = upstreamArtifacts[0].commitSha ?? '(no commit)';
    const previousSha = upstreamArtifacts[1].commitSha ?? '(no commit)';
    if (currentSha === previousSha) {
      return {
        kind: 'ignore',
        reason: 'Upstream re-ran but produced the same commit — no impact.',
      };
    }

    // Build prompt + call AI.
    const prompt = [
      `You are an impact-analysis assistant for a Meta Workflow run.`,
      `Phase ${phase.phaseId} (type ${phase.phaseType}) is currently STALE because its upstream phase ${upstreamPhase.phaseId} (type ${upstreamPhase.phaseType}) was re-run.`,
      `Upstream's previous commit: ${previousSha}`,
      `Upstream's current commit:  ${currentSha}`,
      ``,
      `Decide whether the downstream phase should be re-run, ignored, or only requires a minor fix.`,
      `Reply with a single JSON object on its own line, exactly: {"kind":"rerun"|"ignore"|"minor-fix","reason":"<short reason>"}`,
      `Do not add any other text before or after the JSON.`,
    ].join('\n');

    let collected = '';
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => resolve(), 60_000);
      this.opts.aiRunPort!.startVirtualRun({
        input: prompt,
        onMessage: (m) => {
          if (m.content) collected += m.content;
          if (m.kind === 'run_completed' || m.kind === 'completed' || m.kind === 'final') {
            clearTimeout(timer);
            resolve();
          }
        },
      }).catch(() => {
        clearTimeout(timer);
        resolve();
      });
    });

    // Try to extract JSON.
    const match = collected.match(/\{[^{}]*"kind"\s*:\s*"(rerun|ignore|minor-fix)"[^{}]*\}/);
    if (!match) {
      return {
        kind: 'rerun',
        reason: `AI returned unparseable response (raw: ${collected.slice(0, 200) || '(empty)'})`,
      };
    }
    try {
      const parsed = JSON.parse(match[0]) as { kind: 'rerun' | 'ignore' | 'minor-fix'; reason: string };
      if (typeof parsed.reason !== 'string' || parsed.reason.length === 0) {
        throw new Error('reason missing');
      }
      return parsed;
    } catch {
      return {
        kind: 'rerun',
        reason: `AI returned unparseable response (raw: ${collected.slice(0, 200)})`,
      };
    }
  }

  async cascadeRerun(runId: string, phaseId: string): Promise<PhaseExecutionResult[]> {
    const results: PhaseExecutionResult[] = [];
    const run = this.runRepo.findById(runId);
    if (!run?.phasesJson) throw new Error(`Run has no phasesJson`);
    const validation = validatePhasesJson(run.phasesJson);
    if (!validation.ok) throw new Error(`phasesJson invalid`);

    // BFS from phaseId downward (inclusive).
    const queue: string[] = [phaseId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const next = queue.shift();
      if (!next || visited.has(next)) continue;
      visited.add(next);
      results.push(await this.rerunPhase(runId, next));
      const directDown = validation.doc.phases
        .filter((p) => p.dependsOn.includes(next))
        .map((p) => p.id);
      queue.push(...directDown);
    }
    return results;
  }
}
