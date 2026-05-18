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

export interface WorktreeAllocator {
  acquire(meta: { runId: string; phaseId: string; attempt: number }): Promise<string>;
  release(path: string): Promise<void>;
}

export interface MetaWorkflowServiceOptions {
  db: Database;
  runEntityForWorkflow: RunEntity;
  runEntityForSubagent: RunEntity;
  worktreeAllocator: WorktreeAllocator;
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
  // Used by `runPhase` once Phase D Task 7 wires artifact creation into the executor.
  private artifactRepo: MetaWorkflowArtifactRepository;
  private poolRepo: MetaWorkflowReusePoolRepository;
  private subagentRepo: MetaSubagentTemplateRepository;
  private runAggregate: MetaWorkflowRunAggregate;
  private phaseAggregate: MetaWorkflowPhaseAggregate;
  private search: ReusePoolSearchService;
  private promotion: ReusePoolPromotionService;

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
}
