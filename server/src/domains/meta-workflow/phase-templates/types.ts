import type {
  PhaseType,
  ExecuteEntity,
  ExecutePattern,
  AcceptanceGate,
} from '@my-claudia/shared/features/meta-workflow';

/**
 * A phaseType template describes the defaults the synthesizer should apply
 * when generating an execution entity for a phase of this type.
 *
 * Phase A ships only the type contract + stubs.
 * Phase B will add `buildSynthesizerPrompt()` and `defaultAcceptanceGates()`
 * methods on these templates.
 */
export interface PhaseTemplate {
  readonly phaseType: PhaseType;

  /** Default execute entity (workflow vs subagent). */
  readonly defaultExecuteEntity: ExecuteEntity;

  /** Default execute pattern for workflow entities. */
  readonly defaultExecutePattern?: ExecutePattern;

  /** Whether the plan node is on by default for this phaseType. */
  readonly defaultPlanRequired: boolean;

  /**
   * A short, human-readable description that helps the synthesizer
   * understand when this template applies.
   */
  readonly description: string;

  /**
   * Default acceptance-gate skeletons (commands are project-tooling specific
   * and parameterized at synthesis time).
   *
   * Phase A ships empty arrays as stubs; Phase B fills them.
   */
  readonly defaultGateSkeletons: AcceptanceGate[];
}
