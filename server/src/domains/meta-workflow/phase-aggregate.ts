// server/src/domains/meta-workflow/phase-aggregate.ts
import type {
  MetaWorkflowPhase,
  PhaseDef,
  ExecuteEntity,
} from '@my-claudia/shared/features/meta-workflow';
import { MetaWorkflowPhaseRepository } from './repositories/meta-workflow-phase-repository.js';
import { assertPhaseTransition, assertPhaseStatusIn } from './status-machine.js';
import { getPhaseTemplate } from './phase-templates/index.js';

const DEFAULT_MAX_RETRIES = 3;

export class MetaWorkflowPhaseAggregate {
  constructor(private repo: MetaWorkflowPhaseRepository) {}

  instantiate(runId: string, def: PhaseDef): MetaWorkflowPhase {
    const template = getPhaseTemplate(def.phaseType);
    const executeEntity: ExecuteEntity = def.executeEntity ?? template.defaultExecuteEntity;
    const now = Date.now();
    return this.repo.create({
      runId,
      phaseId: def.id,
      phaseType: def.phaseType,
      status: 'pending',
      executeEntity,
      attempt: 0,
      maxRetries: DEFAULT_MAX_RETRIES,
      inputsSnapshot: def.inputs,
      outputsSnapshot: def.outputs,
      gatesSnapshot: def.acceptanceGates,
      executeConfigSnapshot: def.executeConfig,
      synthesizerProviderId: def.synthesizerProviderId,
      runtimeProviderId: def.runtimeProviderId,
      createdAt: now,
    });
  }

  enterSearchingReuse(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['pending'], 'enter searching_reuse');
    assertPhaseTransition(phase.status, 'searching_reuse');
    return this.repo.update(phaseId, { status: 'searching_reuse' });
  }

  enterGenerating(phaseId: string, opts?: { reusedFromPoolId?: string }): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['searching_reuse'], 'enter generating');
    assertPhaseTransition(phase.status, 'generating');
    return this.repo.update(phaseId, {
      status: 'generating',
      reusedFromPoolId: opts?.reusedFromPoolId,
    });
  }

  enterReadyToRun(phaseId: string, opts?: {
    generatedWorkflowId?: string;
    generatedSubagentId?: string;
  }): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['searching_reuse', 'generating'], 'enter ready_to_run');
    assertPhaseTransition(phase.status, 'ready_to_run');
    return this.repo.update(phaseId, {
      status: 'ready_to_run',
      generatedWorkflowId: opts?.generatedWorkflowId,
      generatedSubagentId: opts?.generatedSubagentId,
    });
  }

  enterRunning(phaseId: string, opts?: {
    currentRunId?: string;
    worktreePath?: string;
  }): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['ready_to_run'], 'enter running');
    assertPhaseTransition(phase.status, 'running');
    return this.repo.update(phaseId, {
      status: 'running',
      currentRunId: opts?.currentRunId,
      worktreePath: opts?.worktreePath,
      attempt: phase.attempt + 1,
      startedAt: Date.now(),
    });
  }

  enterVerifyingGates(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['running'], 'enter verifying_gates');
    assertPhaseTransition(phase.status, 'verifying_gates');
    return this.repo.update(phaseId, { status: 'verifying_gates' });
  }

  markDone(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseTransition(phase.status, 'done');
    assertPhaseStatusIn(phase.status, ['verifying_gates'], 'mark done');
    return this.repo.update(phaseId, { status: 'done', completedAt: Date.now() });
  }

  markFailed(phaseId: string, _reason?: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(
      phase.status,
      ['searching_reuse', 'generating', 'ready_to_run', 'running', 'verifying_gates'],
      'mark failed',
    );
    assertPhaseTransition(phase.status, 'failed');
    return this.repo.update(phaseId, { status: 'failed', completedAt: Date.now() });
  }

  markStale(phaseId: string, staleSourcePhaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    // Only `done` is meaningfully "stale" — a `pending` phase will naturally read fresh
    // upstream artifacts when it eventually runs, so we ignore the call.
    if (phase.status === 'pending') return phase;
    assertPhaseStatusIn(phase.status, ['done'], 'mark stale');
    assertPhaseTransition(phase.status, 'stale');
    return this.repo.update(phaseId, {
      status: 'stale',
      staleSince: Date.now(),
      staleSourcePhaseId,
    });
  }

  clearStale(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['stale'], 'clear stale on');
    assertPhaseTransition(phase.status, 'done');
    return this.repo.update(phaseId, {
      status: 'done',
      staleSince: null,
      staleSourcePhaseId: null,
    });
  }

  resetToPending(phaseId: string): MetaWorkflowPhase {
    const phase = this.requirePhase(phaseId);
    assertPhaseStatusIn(phase.status, ['failed', 'stale'], 'reset to pending');
    assertPhaseTransition(phase.status, 'pending');
    return this.repo.update(phaseId, { status: 'pending' });
  }

  private requirePhase(phaseId: string): MetaWorkflowPhase {
    const phase = this.repo.findById(phaseId);
    if (!phase) throw new Error(`Phase not found: ${phaseId}`);
    return phase;
  }
}
