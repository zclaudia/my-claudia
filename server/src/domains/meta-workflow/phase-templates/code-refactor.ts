// server/src/domains/meta-workflow/phase-templates/code-refactor.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const codeRefactorTemplate: PhaseTemplate = {
  phaseType: 'code-refactor',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Refactor existing code while preserving behavior (tests unchanged).',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that refactors code in phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: code-refactor.`,
      `Behavior must NOT change. The full test suite must pass before AND after this phase.`,
      `Use the self-healing pattern: refactor → run tests → if behavior changed, revise.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
