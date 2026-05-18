import type { PhaseTemplate } from './types.js';

export const depUpdateTemplate: PhaseTemplate = {
  phaseType: 'dep-update',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'self-healing',
  defaultPlanRequired: true,
  description: 'Upgrade dependencies, modify build scripts, or change project configuration.',
  defaultGateSkeletons: [],
};
