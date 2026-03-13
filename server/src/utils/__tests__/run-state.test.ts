import { describe, it, expect } from 'vitest';
import {
  isForegroundActiveRun,
  hasForegroundActiveRunForSession,
  findForegroundActiveRunIdForSession,
  hasAnyActiveRunForSession,
} from '../run-state.js';

describe('run-state helpers', () => {
  it('treats only non-completed non-background as foreground active', () => {
    expect(isForegroundActiveRun(undefined)).toBe(false);
    expect(isForegroundActiveRun({ completed: false, sessionType: 'regular' })).toBe(true);
    expect(isForegroundActiveRun({ completed: true, sessionType: 'regular' })).toBe(false);
    expect(isForegroundActiveRun({ completed: false, sessionType: 'background' })).toBe(false);
    expect(isForegroundActiveRun({ completed: false })).toBe(true);
  });

  it('detects active session with unified logic', () => {
    const runs = new Map<string, any>([
      ['r1', { sessionId: 's1', completed: true, sessionType: 'regular' }],
      ['r2', { sessionId: 's1', completed: false, sessionType: 'background' }],
      ['r3', { sessionId: 's2', completed: false, sessionType: 'regular' }],
    ]);

    expect(hasForegroundActiveRunForSession(runs, 's1')).toBe(false);
    expect(hasForegroundActiveRunForSession(runs, 's2')).toBe(true);
  });

  it('finds run id only for foreground active run', () => {
    const runs = new Map<string, any>([
      ['r1', { sessionId: 's1', completed: true, sessionType: 'regular' }],
      ['r2', { sessionId: 's1', completed: false, sessionType: 'regular' }],
    ]);

    expect(findForegroundActiveRunIdForSession(runs, 's1')).toBe('r2');
    expect(findForegroundActiveRunIdForSession(runs, 'missing')).toBeNull();
  });

  it('hasAnyActiveRunForSession includes background runs', () => {
    const runs = new Map<string, any>([
      ['r1', { sessionId: 's1', completed: false, sessionType: 'background' }],
      ['r2', { sessionId: 's2', completed: true, sessionType: 'regular' }],
    ]);

    expect(hasAnyActiveRunForSession(runs, 's1')).toBe(true);
    expect(hasAnyActiveRunForSession(runs, 's2')).toBe(false);
    expect(hasAnyActiveRunForSession(runs, 'missing')).toBe(false);
  });

  it('hasAnyActiveRunForSession returns false for empty map', () => {
    expect(hasAnyActiveRunForSession(new Map(), 's1')).toBe(false);
  });
});
