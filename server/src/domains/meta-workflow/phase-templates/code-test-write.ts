import type { PhaseTemplate } from './types.js';

export const codeTestWriteTemplate: PhaseTemplate = {
  phaseType: 'code-test-write',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'multi-step',
  defaultPlanRequired: false,
  description: 'Write tests for code that is already implemented.',
  defaultGateSkeletons: [],
};
