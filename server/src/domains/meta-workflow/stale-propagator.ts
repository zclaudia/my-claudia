// server/src/domains/meta-workflow/stale-propagator.ts
import type { PhasesDoc } from '@my-claudia/shared/features/meta-workflow';
import type { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
import type { MetaWorkflowArtifactRepository } from './repositories/meta-workflow-artifact-repository.js';
import type { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';

export interface StalePropagatorOptions {
  phaseRepo: MetaWorkflowPhaseRepository;
  artifactRepo: MetaWorkflowArtifactRepository;
  phaseAggregate: MetaWorkflowPhaseAggregate;
}

export class StalePropagator {
  constructor(private opts: StalePropagatorOptions) {}

  /**
   * Lazy + Soft: when `sourcePhaseId` has finished a new run (with possibly
   * changed artifact), mark every DIRECT downstream phase that is currently
   * `done` as stale, and flip its artifacts active → stale. Pending downstreams
   * are skipped — they will naturally pick up the fresh upstream artifact
   * when they eventually run.
   */
  propagateUpstreamRerun(runId: string, sourcePhaseId: string, phasesDoc: PhasesDoc): void {
    const downstreamIds = phasesDoc.phases
      .filter((p) => p.dependsOn.includes(sourcePhaseId))
      .map((p) => p.id);

    for (const phaseId of downstreamIds) {
      const phaseRecord = this.opts.phaseRepo.findByRunAndPhaseId(runId, phaseId);
      if (!phaseRecord) continue;
      if (phaseRecord.status !== 'done') continue;

      this.opts.phaseAggregate.markStale(phaseRecord.id, sourcePhaseId);
      this.opts.artifactRepo.markAllStaleForPhase(phaseRecord.id);
    }
  }
}
