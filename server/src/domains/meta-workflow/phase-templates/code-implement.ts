import type { PhaseTemplate } from './types.js';

export const codeImplementTemplate: PhaseTemplate = {
  phaseType: 'code-implement',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Implement a new feature, interface, or class in code.',
  defaultGateSkeletons: [],
};
