// server/src/domains/meta-workflow/phase-templates/design-doc.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const designDocTemplate: PhaseTemplate = {
  phaseType: 'design-doc',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'single-shot',
  defaultPlanRequired: false,
  description: 'Author a design document, API spec, or interface contract — no code produced.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that authors a design document for phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: design-doc.`,
      `No code change. Use the single-shot pattern: write the document at the path specified in outputs.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
