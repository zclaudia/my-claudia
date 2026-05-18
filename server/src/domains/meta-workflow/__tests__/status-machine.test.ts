import { describe, it, expect } from 'vitest';
import {
  assertRunTransition,
  assertPhaseTransition,
  assertRunStatusIn,
  assertPhaseStatusIn,
  TERMINAL_RUN_STATUSES,
  TERMINAL_PHASE_STATUSES,
} from '../status-machine.js';

describe('meta-workflow status machine', () => {
  it('allows run requirement_draft → requirement_review', () => {
    expect(() => assertRunTransition('requirement_draft', 'requirement_review')).not.toThrow();
  });

  it('rejects run completed → requirement_draft', () => {
    expect(() => assertRunTransition('completed', 'requirement_draft')).toThrow(/Invalid run transition/);
  });

  it('same-status is always allowed', () => {
    expect(() => assertRunTransition('executing', 'executing')).not.toThrow();
    expect(() => assertPhaseTransition('running', 'running')).not.toThrow();
  });

  it('phase pending → searching_reuse is allowed', () => {
    expect(() => assertPhaseTransition('pending', 'searching_reuse')).not.toThrow();
  });

  it('phase done → running is forbidden (must re-enter via stale)', () => {
    expect(() => assertPhaseTransition('done', 'running')).toThrow(/Invalid phase transition/);
  });

  it('phase done → stale is allowed (lazy propagation)', () => {
    expect(() => assertPhaseTransition('done', 'stale')).not.toThrow();
  });

  it('phase stale → pending is allowed (cascade or manual rerun)', () => {
    expect(() => assertPhaseTransition('stale', 'pending')).not.toThrow();
  });

  it('phase stale → done is allowed (upstream re-run produced identical artifact)', () => {
    expect(() => assertPhaseTransition('stale', 'done')).not.toThrow();
  });

  it('TERMINAL sets are correct', () => {
    expect(TERMINAL_RUN_STATUSES).toEqual(['completed', 'cancelled']);
    expect(TERMINAL_PHASE_STATUSES).toEqual(['done', 'failed']);
  });

  it('assertRunStatusIn throws on disallowed', () => {
    expect(() => assertRunStatusIn('completed', ['executing'], 'kick off')).toThrow(/Cannot kick off run/);
  });

  it('assertPhaseStatusIn throws on disallowed', () => {
    expect(() => assertPhaseStatusIn('done', ['running'], 'mark failed')).toThrow(/Cannot mark failed phase/);
  });
});
