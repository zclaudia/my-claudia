import { describe, it, expect } from 'vitest';
import { validateSpec, validateDelta } from '../validator.js';
import type { DeltaDoc, ParsedSpec } from '../markdown/types.js';

function mkReq(over: Partial<ParsedSpec['requirements'][number]> = {}): ParsedSpec['requirements'][number] {
  return {
    name: 'R',
    body: 'System MUST do x.',
    rfcKeywords: ['MUST' as const],
    scenarios: [{ name: 'S', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
    ...over,
  };
}

describe('validateSpec', () => {
  it('ok=true for a well-formed spec', () => {
    const spec: ParsedSpec = { capability: 'auth', requirements: [mkReq()] };
    const v = validateSpec(spec);
    expect(v.ok).toBe(true);
  });

  it('flags missing capability', () => {
    const v = validateSpec({ capability: '', requirements: [mkReq()] });
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.message.includes('capability'))).toBe(true);
  });

  it('flags requirement without scenarios as error', () => {
    const v = validateSpec({ capability: 'x', requirements: [mkReq({ scenarios: [] })] });
    expect(v.ok).toBe(false);
    expect(v.issues.some((i) => i.message.includes('Scenario'))).toBe(true);
  });

  it('warns when body lacks RFC keyword', () => {
    const v = validateSpec({
      capability: 'x',
      requirements: [mkReq({ body: 'no keyword here', rfcKeywords: [] })],
    });
    expect(v.ok).toBe(true); // warning, not error
    expect(v.issues.some((i) => i.severity === 'warning' && i.message.includes('RFC'))).toBe(true);
  });

  it('flags scenario with no body lines', () => {
    const v = validateSpec({
      capability: 'x',
      requirements: [mkReq({ scenarios: [{ name: 'S', bodyLines: [] }] })],
    });
    expect(v.ok).toBe(false);
  });
});

describe('validateDelta', () => {
  it('ok=true for non-empty delta with valid added requirement', () => {
    const delta: DeltaDoc = { added: [mkReq()], modified: [], removed: [] };
    expect(validateDelta(delta).ok).toBe(true);
  });

  it('warns when delta is fully empty', () => {
    const v = validateDelta({ added: [], modified: [], removed: [] });
    expect(v.ok).toBe(true);
    expect(v.issues.some((i) => i.message.includes('empty'))).toBe(true);
  });

  it('flags empty name in removed list', () => {
    const v = validateDelta({ added: [], modified: [], removed: ['', 'good'] });
    expect(v.ok).toBe(false);
  });
});
