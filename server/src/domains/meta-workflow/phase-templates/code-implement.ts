// server/src/domains/meta-workflow/phase-templates/code-implement.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const codeImplementTemplate: PhaseTemplate = {
  phaseType: 'code-implement',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Implement a new feature, interface, or class in code.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are generating a workflow that implements phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: code-implement.`,
      `Use the self-healing pattern: write → compile → if fail, fix → re-verify.`,
      `Plan node is required: produce plan.md before execute.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) {
    // Phase B leaves these empty; phases.json supplies real commands.
    return [];
  },
};
