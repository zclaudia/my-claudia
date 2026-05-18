// server/src/domains/meta-workflow/phase-executor.ts
import type {
  MetaWorkflowPhase,
  PhaseDef,
  MetaWorkflowGateResult,
  MetaSubagentTemplate,
} from '@my-claudia/shared/features/meta-workflow';
import type { WorkflowDefinition } from '@my-claudia/shared/features/workflows';
import { MetaWorkflowPhaseAggregate } from './phase-aggregate.js';
import { synthesizeWorkflow } from './workflow-synthesizer.js';
import { synthesizeSubagent } from './subagent-synthesizer.js';
import { runGates } from './gate-runner.js';

export type SynthesizedEntity =
  | { kind: 'workflow'; workflow: WorkflowDefinition; workflowId: string }
  | { kind: 'subagent'; subagent: MetaSubagentTemplate };

export interface RunEntityOutcome {
  exitOk: boolean;
}

export type RunEntity = (entity: SynthesizedEntity, opts: { worktreePath: string }) => Promise<RunEntityOutcome>;

export interface MetaPhaseExecutorOptions {
  aggregate: MetaWorkflowPhaseAggregate;
  /** Injected runner — Phase B uses a stub; Phase C+ wires the real workflow engine. */
  runEntity: RunEntity;
}

export interface PhaseExecutionResult {
  phase: MetaWorkflowPhase;
  gateResults: MetaWorkflowGateResult[];
}

export class MetaPhaseExecutor {
  constructor(private opts: MetaPhaseExecutorOptions) {}

  async execute(
    phaseRecordId: string,
    def: PhaseDef,
    worktreePath: string,
  ): Promise<PhaseExecutionResult> {
    const { aggregate, runEntity } = this.opts;

    // pending → searching_reuse (Phase B: skip pool search, go straight to generating)
    aggregate.enterSearchingReuse(phaseRecordId);
    aggregate.enterGenerating(phaseRecordId);

    // Synthesize the entity according to executeEntity.
    const executeEntity = def.executeEntity ?? this.defaultExecuteEntityFor(def.phaseType);
    let entity: SynthesizedEntity;
    if (executeEntity === 'subagent') {
      const subagent = synthesizeSubagent(def);
      entity = { kind: 'subagent', subagent };
      aggregate.enterReadyToRun(phaseRecordId, { generatedSubagentId: subagent.id });
    } else {
      const workflow = synthesizeWorkflow(def);
      const workflowId = `auto-${phaseRecordId}`;
      entity = { kind: 'workflow', workflow, workflowId };
      aggregate.enterReadyToRun(phaseRecordId, { generatedWorkflowId: workflowId });
    }

    aggregate.enterRunning(phaseRecordId, { worktreePath });

    let runOutcome: RunEntityOutcome;
    try {
      runOutcome = await runEntity(entity, { worktreePath });
    } catch (e) {
      const phase = aggregate.markFailed(phaseRecordId, (e as Error).message);
      return { phase, gateResults: [] };
    }

    if (!runOutcome.exitOk) {
      const phase = aggregate.markFailed(phaseRecordId, 'entity runner reported failure');
      return { phase, gateResults: [] };
    }

    aggregate.enterVerifyingGates(phaseRecordId);

    const gateResults = await runGates(def.acceptanceGates, worktreePath);
    const allPassed = gateResults.every((r) => r.passed);

    const phase = allPassed
      ? aggregate.markDone(phaseRecordId)
      : aggregate.markFailed(phaseRecordId, 'one or more acceptance gates failed');
    return { phase, gateResults };
  }

  private defaultExecuteEntityFor(phaseType: PhaseDef['phaseType']): 'workflow' | 'subagent' {
    return phaseType === 'investigation' ? 'subagent' : 'workflow';
  }
}
