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
  release(path: string): Promise<void>;
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
    _runId: string,
    _phaseId: string,
  ): Promise<{ kind: 'rerun' | 'ignore' | 'minor-fix'; reason: string }> {
    // Phase D MVP: static recommendation. Detailed diff analysis lands in Phase E.
    return {
      kind: 'rerun',
      reason: 'Upstream changed; defaulting to re-run. Detailed diff analysis lands in Phase E.',
    };
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
