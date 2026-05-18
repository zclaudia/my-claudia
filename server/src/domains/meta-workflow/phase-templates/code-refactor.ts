import type { PhaseTemplate } from './types.js';

export const codeRefactorTemplate: PhaseTemplate = {
  phaseType: 'code-refactor',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Refactor existing code while preserving behavior (tests unchanged).',
  defaultGateSkeletons: [],
};
