import type { PhaseType } from '@my-claudia/shared/features/meta-workflow';
import type { PhaseTemplate } from './types.js';

import { codeImplementTemplate } from './code-implement.js';
import { codeRefactorTemplate } from './code-refactor.js';
import { codeTestWriteTemplate } from './code-test-write.js';
import { designDocTemplate } from './design-doc.js';
import { depUpdateTemplate } from './dep-update.js';
import { investigationTemplate } from './investigation.js';

export { PhaseTemplate };

export const PHASE_TEMPLATES: readonly PhaseTemplate[] = [
  codeImplementTemplate,
  codeRefactorTemplate,
  codeTestWriteTemplate,
  designDocTemplate,
  depUpdateTemplate,
  investigationTemplate,
];

const TEMPLATE_BY_TYPE = new Map<PhaseType, PhaseTemplate>(
  PHASE_TEMPLATES.map((t) => [t.phaseType, t]),
);

export function getPhaseTemplate(phaseType: PhaseType): PhaseTemplate {
  const template = TEMPLATE_BY_TYPE.get(phaseType);
  if (!template) {
    throw new Error(`Unknown phaseType: ${phaseType}`);
  }
  return template;
}
