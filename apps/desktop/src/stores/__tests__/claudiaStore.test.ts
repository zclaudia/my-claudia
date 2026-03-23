import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useClaudiaStore } from '../claudiaStore';

describe('claudiaStore', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      value: { localStorage: globalThis.localStorage },
      configurable: true,
      writable: true,
    });
    localStorage.clear();
    useClaudiaStore.setState({
      isExpanded: false,
      claudiaSessionId: null,
      lastViewedAt: 0,
      activeBranchIds: {},
      tasks: [],
      streamingText: {},
      inlineResponses: [],
      continueTaskId: null,
    });
  });

  it('updates inline timestamps without auto-marking viewed when collapsed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T10:00:00Z'));

    useClaudiaStore.getState().startInline('req-1', 'hello');
    vi.setSystemTime(new Date('2026-03-23T10:00:02Z'));
    useClaudiaStore.getState().completeInline('req-1', 'done');

    const response = useClaudiaStore.getState().inlineResponses[0];
    expect(response.createdAt).toBe(new Date('2026-03-23T10:00:00Z').getTime());
    expect(response.updatedAt).toBe(new Date('2026-03-23T10:00:02Z').getTime());
    expect(useClaudiaStore.getState().lastViewedAt).toBe(0);

    vi.useRealTimers();
  });

  it('marks inline updates as viewed when the panel is expanded', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-23T11:00:00Z'));

    useClaudiaStore.setState({ isExpanded: true, lastViewedAt: 0 });
    useClaudiaStore.getState().startInline('req-2', 'hello');

    const now = new Date('2026-03-23T11:00:00Z').getTime();
    expect(useClaudiaStore.getState().lastViewedAt).toBe(now);
    expect(localStorage.getItem('claudia-last-viewed-at')).toBe(String(now));

    vi.useRealTimers();
  });

  it('tracks activeBranchId per project in memory', () => {
    useClaudiaStore.getState().setActiveBranchId('project-1', 'branch-1');

    expect(useClaudiaStore.getState().activeBranchIds).toEqual({ 'project-1': 'branch-1' });
  });

  it('clears activeBranchIds on reset', () => {
    useClaudiaStore.getState().setActiveBranchId('project-2', 'branch-2');
    useClaudiaStore.getState().reset();

    expect(useClaudiaStore.getState().activeBranchIds).toEqual({});
  });
});
