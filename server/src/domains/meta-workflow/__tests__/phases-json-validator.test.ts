// server/src/domains/meta-workflow/__tests__/phases-json-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validatePhasesJson } from '../phases-json-validator.js';

const validDoc = {
  version: '1',
  phases: [
    {
      id: 'p1', name: 'Design', description: '', phaseType: 'design-doc',
      dependsOn: [], inputs: [], outputs: [{ kind: 'file', path: 'design/a.md', description: 'spec' }],
      acceptanceGates: [{ id: 'g1', description: 'doc exists', command: 'test -f design/a.md', expect: {} }],
    },
    {
      id: 'p2', name: 'Implement', description: '', phaseType: 'code-implement',
      dependsOn: ['p1'], inputs: [{ kind: 'file', source: 'design/a.md' }],
      outputs: [{ kind: 'commit', description: 'impl' }],
      acceptanceGates: [{ id: 'g2', description: 'compile', command: 'mvn compile', expect: { exitCode: 0 } }],
    },
  ],
  smokePath: ['p1', 'p2'],
  metadata: { generatedAt: 0, requirementsPath: 'design/requirements.md' },
};

describe('phases.json validator', () => {
  it('accepts a valid doc', () => {
    const result = validatePhasesJson(JSON.stringify(validDoc));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.doc.phases).toHaveLength(2);
  });

  it('rejects malformed JSON', () => {
    const result = validatePhasesJson('{not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/JSON/);
  });

  it('rejects missing version', () => {
    const bad = { ...validDoc, version: undefined };
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects invalid phaseType', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].phaseType = 'invalid';
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/phaseType/);
  });

  it('rejects dangling dependsOn', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[1].dependsOn = ['nonexistent'];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/nonexistent/);
  });

  it('detects cycles', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].dependsOn = ['p2'];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/cycle/i);
  });

  it('requires at least one root', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].dependsOn = ['p2'];
    bad.phases[1].dependsOn = ['p1'];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });

  it('rejects smokePath referencing missing phase', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.smokePath = ['p1', 'nonexistent'];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/smokePath/);
  });

  it('rejects empty acceptanceGates', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].acceptanceGates = [];
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('|')).toMatch(/acceptanceGates/);
  });

  it('rejects acceptanceGate with empty command', () => {
    const bad = JSON.parse(JSON.stringify(validDoc));
    bad.phases[0].acceptanceGates[0].command = '';
    const result = validatePhasesJson(JSON.stringify(bad));
    expect(result.ok).toBe(false);
  });
});
