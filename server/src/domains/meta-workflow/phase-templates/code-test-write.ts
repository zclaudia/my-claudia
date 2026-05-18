// server/src/domains/meta-workflow/phase-templates/code-test-write.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const codeTestWriteTemplate: PhaseTemplate = {
  phaseType: 'code-test-write',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'multi-step',
  defaultPlanRequired: false,
  description: 'Write tests for code that is already implemented.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that writes tests for phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: code-test-write.`,
      `Use the multi-step pattern: identify uncovered behavior → write tests → run them → verify pass.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
