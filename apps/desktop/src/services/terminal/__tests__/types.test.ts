import { describe, it, expect } from 'vitest';
import {
  TERMINAL_LIFECYCLE_TRANSITIONS,
  canTransition,
  isTerminalReady,
  isTerminalBusy,
  isTerminalTerminal,
  type TerminalLifecycleKind,
  type TerminalLifecycleState,
} from '../types';

const ALL_KINDS: TerminalLifecycleKind[] = [
  'idle',
  'opening',
  'attaching',
  'open',
  'detached',
  'failed',
  'exited',
  'disposed',
];

describe('TerminalLifecycle types', () => {
  it('every kind has an entry in the transition matrix', () => {
    for (const k of ALL_KINDS) {
      expect(TERMINAL_LIFECYCLE_TRANSITIONS).toHaveProperty(k);
    }
  });

  it('disposed has no outgoing transitions (terminal state)', () => {
    expect(TERMINAL_LIFECYCLE_TRANSITIONS.disposed).toEqual([]);
  });

  it('canTransition matches the matrix', () => {
    expect(canTransition('idle', 'opening')).toBe(true);
    expect(canTransition('idle', 'attaching')).toBe(true);
    expect(canTransition('idle', 'open')).toBe(false);

    expect(canTransition('opening', 'open')).toBe(true);
    expect(canTransition('opening', 'failed')).toBe(true);
    expect(canTransition('opening', 'detached')).toBe(false);

    expect(canTransition('open', 'detached')).toBe(true);
    expect(canTransition('open', 'exited')).toBe(true);
    expect(canTransition('open', 'opening')).toBe(false);

    expect(canTransition('detached', 'attaching')).toBe(true);
    expect(canTransition('detached', 'open')).toBe(false);

    expect(canTransition('disposed', 'idle')).toBe(false);
    expect(canTransition('exited', 'disposed')).toBe(true);
    expect(canTransition('exited', 'open')).toBe(false);
  });

  it('failed allows user-driven retry back to opening or attaching', () => {
    expect(canTransition('failed', 'opening')).toBe(true);
    expect(canTransition('failed', 'attaching')).toBe(true);
    expect(canTransition('failed', 'open')).toBe(false);
  });

  it('attaching can transition directly to exited (server-forwarded pending exit)', () => {
    expect(canTransition('attaching', 'exited')).toBe(true);
    expect(canTransition('opening', 'exited')).toBe(false);
  });

  it('predicates classify states correctly', () => {
    const open: TerminalLifecycleState = { kind: 'open' };
    const opening: TerminalLifecycleState = { kind: 'opening' };
    const attaching: TerminalLifecycleState = { kind: 'attaching' };
    const detached: TerminalLifecycleState = { kind: 'detached', reason: 'popout' };
    const exited: TerminalLifecycleState = { kind: 'exited', code: 0 };
    const disposed: TerminalLifecycleState = { kind: 'disposed' };

    expect(isTerminalReady(open)).toBe(true);
    expect(isTerminalReady(detached)).toBe(false);

    expect(isTerminalBusy(opening)).toBe(true);
    expect(isTerminalBusy(attaching)).toBe(true);
    expect(isTerminalBusy(open)).toBe(false);

    expect(isTerminalTerminal(exited)).toBe(true);
    expect(isTerminalTerminal(disposed)).toBe(true);
    expect(isTerminalTerminal(detached)).toBe(false);
  });
});
