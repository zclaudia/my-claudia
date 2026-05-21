import { describe, it, expect } from 'vitest';
import { applyDelta, applyDeltaToEmptyCorpus } from '../delta-merger.js';
import type { ParsedSpec, ParsedRequirement } from '../markdown/types.js';

function mkReq(name: string, body = 'MUST do.'): ParsedRequirement {
  return {
    name,
    body,
    rfcKeywords: ['MUST'],
    scenarios: [{ name: 's', bodyLines: ['- **WHEN** x', '- **THEN** y'] }],
  };
}

describe('applyDelta', () => {
  it('ADDED inserts a new requirement', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A')] };
    const result = applyDelta(corpus, { added: [mkReq('B')], modified: [], removed: [] });
    expect(result.spec.requirements.map((r) => r.name)).toEqual(['A', 'B']);
    expect(result.added).toEqual(['B']);
  });

  it('MODIFIED replaces existing requirement body, keeps position', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A'), mkReq('B'), mkReq('C')] };
    const newB = mkReq('B', 'SHALL be updated.');
    const result = applyDelta(corpus, { added: [], modified: [newB], removed: [] });
    expect(result.spec.requirements.map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(result.spec.requirements[1].body).toBe('SHALL be updated.');
    expect(result.modified).toEqual(['B']);
  });

  it('REMOVED drops a requirement', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A'), mkReq('B')] };
    const result = applyDelta(corpus, { added: [], modified: [], removed: ['A'] });
    expect(result.spec.requirements.map((r) => r.name)).toEqual(['B']);
    expect(result.removed).toEqual(['A']);
  });

  it('ADDED collision is reported, original kept', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A', 'original')] };
    const result = applyDelta(corpus, { added: [mkReq('A', 'new')], modified: [], removed: [] });
    expect(result.addedConflicts).toEqual(['A']);
    expect(result.spec.requirements[0].body).toBe('original');
  });

  it('MODIFIED missing target is reported, inserted anyway', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A')] };
    const result = applyDelta(corpus, { added: [], modified: [mkReq('B', 'new')], removed: [] });
    expect(result.modifiedMissing).toEqual(['B']);
    expect(result.spec.requirements.map((r) => r.name)).toContain('B');
  });

  it('REMOVED missing target is reported, no error', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A')] };
    const result = applyDelta(corpus, { added: [], modified: [], removed: ['B'] });
    expect(result.removedMissing).toEqual(['B']);
  });

  it('combined ADD + MODIFY + REMOVE in one delta', () => {
    const corpus: ParsedSpec = { capability: 'x', requirements: [mkReq('A'), mkReq('B'), mkReq('C')] };
    const result = applyDelta(corpus, {
      added: [mkReq('D')],
      modified: [mkReq('B', 'changed')],
      removed: ['A'],
    });
    expect(result.spec.requirements.map((r) => r.name)).toEqual(['B', 'C', 'D']);
    expect(result.spec.requirements[0].body).toBe('changed');
  });

  it('applyDeltaToEmptyCorpus handles ADDED-only delta', () => {
    const result = applyDeltaToEmptyCorpus('newcap', { added: [mkReq('R1')], modified: [], removed: [] });
    expect(result.spec.capability).toBe('newcap');
    expect(result.spec.requirements).toHaveLength(1);
    expect(result.added).toEqual(['R1']);
  });

  it('corpus purpose is preserved across merge', () => {
    const corpus: ParsedSpec = { capability: 'x', purpose: 'Original purpose.', requirements: [mkReq('A')] };
    const result = applyDelta(corpus, { added: [mkReq('B')], modified: [], removed: [], purpose: 'change purpose' });
    expect(result.spec.purpose).toBe('Original purpose.');
  });
});
