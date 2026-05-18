import type { PhaseTemplate } from './types.js';

export const investigationTemplate: PhaseTemplate = {
  phaseType: 'investigation',
  defaultExecuteEntity: 'subagent',
  defaultExecutePattern: undefined,    // subagent doesn't use workflow patterns
  defaultPlanRequired: false,
  description: 'Investigate, research, or analyze — produces a written report, no code change.',
  defaultGateSkeletons: [],
};
