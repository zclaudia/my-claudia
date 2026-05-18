import { describe, it, expect } from 'vitest';
import { PHASE_TYPES } from '@my-claudia/shared/features/meta-workflow';
import {
  PHASE_TEMPLATES,
  getPhaseTemplate,
} from '../phase-templates/index.js';

describe('phase template registry', () => {
  it('registers exactly 6 templates', () => {
    expect(PHASE_TEMPLATES).toHaveLength(6);
  });

  it('covers every PhaseType in the shared enum', () => {
    const registered = new Set(PHASE_TEMPLATES.map((t) => t.phaseType));
    for (const pt of PHASE_TYPES) {
      expect(registered).toContain(pt);
    }
  });

  it('investigation defaults to subagent', () => {
    expect(getPhaseTemplate('investigation').defaultExecuteEntity).toBe('subagent');
  });

  it('code-implement defaults to workflow + self-healing + planRequired', () => {
    const t = getPhaseTemplate('code-implement');
    expect(t.defaultExecuteEntity).toBe('workflow');
    expect(t.defaultExecutePattern).toBe('self-healing');
    expect(t.defaultPlanRequired).toBe(true);
  });

  it('design-doc defaults to single-shot, plan off', () => {
    const t = getPhaseTemplate('design-doc');
    expect(t.defaultExecutePattern).toBe('single-shot');
    expect(t.defaultPlanRequired).toBe(false);
  });

  it('getPhaseTemplate throws on unknown phaseType', () => {
    // @ts-expect-error — intentionally pass an invalid value at runtime
    expect(() => getPhaseTemplate('nonexistent')).toThrow(/Unknown phaseType/);
  });
});
