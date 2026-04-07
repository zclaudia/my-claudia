import { describe, expect, it } from 'vitest';
import {
  assertTaskStatus,
  assertTaskStatusIn,
  assertTaskTransition,
  getLiteFailureTransition,
} from '../status-machine.js';

describe('supervision status machine', () => {
  it('allows valid lifecycle transitions', () => {
    expect(() => assertTaskTransition('proposed', 'pending')).not.toThrow();
    expect(() => assertTaskTransition('planning', 'queued')).not.toThrow();
    expect(() => assertTaskTransition('running', 'pending')).not.toThrow();
    expect(() => assertTaskTransition('reviewing', 'integrated')).not.toThrow();
    expect(() => assertTaskTransition('reviewing', 'merge_conflict')).not.toThrow();
  });

  it('rejects invalid lifecycle transitions', () => {
    expect(() => assertTaskTransition('proposed', 'running')).toThrow("Invalid task transition: 'proposed' -> 'running'");
    expect(() => assertTaskTransition('merge_conflict', 'failed')).toThrow();
  });

  it('validates exact status requirements', () => {
    expect(() => assertTaskStatus('reviewing', 'reviewing', 'approve result for')).not.toThrow();
    expect(() => assertTaskStatus('queued', 'reviewing', 'approve result for')).toThrow(
      "Cannot approve result for task in status 'queued'; must be 'reviewing'",
    );
  });

  it('validates allowed status sets', () => {
    expect(() => assertTaskStatusIn('failed', ['failed', 'cancelled'], 'retry')).not.toThrow();
    expect(() => assertTaskStatusIn('running', ['failed', 'cancelled'], 'retry')).toThrow(
      "Cannot retry task in status 'running'",
    );
  });

  it('computes lite failure transitions based on retry budget', () => {
    expect(getLiteFailureTransition(1, 2)).toEqual({ nextStatus: 'pending', nextAttempt: 2 });
    expect(getLiteFailureTransition(3, 2)).toEqual({ nextStatus: 'failed', nextAttempt: 4 });
  });
});
