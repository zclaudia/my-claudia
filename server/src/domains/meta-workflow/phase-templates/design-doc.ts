import type { PhaseTemplate } from './types.js';

export const designDocTemplate: PhaseTemplate = {
  phaseType: 'design-doc',
  defaultExecuteEntity: 'workflow',
  defaultExecutePattern: 'single-shot',
  defaultPlanRequired: false,
  description: 'Author a design document, API spec, or interface contract — no code produced.',
  defaultGateSkeletons: [],
};
