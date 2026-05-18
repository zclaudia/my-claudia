// server/src/domains/meta-workflow/__tests__/subagent-synthesizer.test.ts
import { describe, it, expect } from 'vitest';
import { synthesizeSubagent } from '../subagent-synthesizer.js';
import type { PhaseDef } from '@my-claudia/shared/features/meta-workflow';

const investigationPhase: PhaseDef = {
  id: 'p1', name: 'Investigate', description: 'figure out why X is slow',
  phaseType: 'investigation',
  dependsOn: [],
  inputs: [],
  outputs: [{ kind: 'file', path: 'investigation-report.md', description: 'report' }],
  acceptanceGates: [
    { id: 'has-report', description: 'report exists', command: 'test -s investigation-report.md', expect: { exitCode: 0 } },
  ],
};

describe('subagent synthesizer', () => {
  it('produces a template with phaseType-specific prompt', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.systemPrompt).toMatch(/investigate/i);
    expect(tmpl.systemPrompt).toMatch(/Do NOT write code/);
  });

  it('restricts tools to read-only set for investigation', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.allowedTools).toContain('Read');
    expect(tmpl.allowedTools).toContain('Grep');
    expect(tmpl.allowedTools).not.toContain('Edit');
    expect(tmpl.allowedTools).not.toContain('Write');
  });

  it('uses output-file termination when outputs contain a file', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.terminationCondition.kind).toBe('output-file');
    expect(tmpl.terminationCondition.target).toBe('investigation-report.md');
  });

  it('default maxTurns is reasonable', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.maxTurns).toBe(30);
  });

  it('respects maxSubagentTurns override from phase config', () => {
    const tmpl = synthesizeSubagent({ ...investigationPhase, executeConfig: { maxSubagentTurns: 12 } });
    expect(tmpl.maxTurns).toBe(12);
  });

  it('sourceType is auto on generation', () => {
    const tmpl = synthesizeSubagent(investigationPhase);
    expect(tmpl.sourceType).toBe('auto');
  });
});
