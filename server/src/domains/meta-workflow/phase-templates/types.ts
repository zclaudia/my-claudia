// server/src/domains/meta-workflow/phase-templates/types.ts
import type {
  PhaseType,
  ExecuteEntity,
  ExecutePattern,
  AcceptanceGate,
  PhaseDef,
} from '@my-claudia/shared/features/meta-workflow';

export interface PhaseTemplate {
  readonly phaseType: PhaseType;
  readonly defaultExecuteEntity: ExecuteEntity;
  readonly defaultExecutePattern?: ExecutePattern;
  readonly defaultPlanRequired: boolean;
  readonly description: string;
  readonly defaultGateSkeletons: AcceptanceGate[];

  /**
   * Construct the synthesizer prompt for a phase of this type.
   * Used by `workflow-synthesizer` / `subagent-synthesizer` to drive
   * the existing `WorkflowGeneratorService` (or subagent prompt build).
   */
  buildSynthesizerPrompt(phase: PhaseDef): string;

  /**
   * Compose the canonical default gates for a phase of this type.
   * Implementations may use `phase` to parameterise commands (e.g.,
   * pick a test class name from outputs). For Phase B, most stubs
   * return an empty array; downstream phases fill them.
   */
  defaultGates(phase: PhaseDef): AcceptanceGate[];
}
