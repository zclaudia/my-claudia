// server/src/domains/meta-workflow/phase-templates/dep-update.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const depUpdateTemplate: PhaseTemplate = {
  phaseType: 'dep-update',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Upgrade dependencies, modify build scripts, or change project configuration.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that updates dependencies for phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: dep-update.`,
      `Use the self-healing pattern: edit build files → build → if breakage, adapt code or pin alternative version.`,
      `Full test suite must pass at the end.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
