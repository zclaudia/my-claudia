// server/src/domains/meta-workflow/phase-templates/investigation.ts
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

export const investigationTemplate: PhaseTemplate = {
  phaseType: 'investigation',
  defaultExecuteEntity: 'subagent',
  defaultExecutePattern: undefined,
  defaultPlanRequired: false,
  description: 'Investigate, research, or analyze — produces a written report, no code change.',
  defaultGateSkeletons: [],
  buildSynthesizerPrompt(phase: PhaseDef): string {
    return [
      `You are an investigation subagent for phase "${phase.id}" (${phase.name}).`,
      `Description: ${phase.description}`,
      ``,
      `Phase type: investigation.`,
      `You may freely read files, grep, run read-only commands. Do NOT write code; you may only write a report file at the path specified in outputs.`,
      ``,
      `When the report exists and is non-empty, finish.`,
      ``,
      `Acceptance gates that MUST pass:`,
      ...phase.acceptanceGates.map((g) => `  - ${g.id}: ${g.command}`),
    ].join('\n');
  },
  defaultGates(_phase: PhaseDef) { return []; },
};
