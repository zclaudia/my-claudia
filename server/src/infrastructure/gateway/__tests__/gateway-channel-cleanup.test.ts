import { describe, expect, it, vi } from 'vitest';
import { handleChannelClosed } from '../gateway-channel-cleanup.js';
import type { ActiveRun } from '../../../application/conversation/ws/types.js';

function createRun(clientId: string, completed = false): ActiveRun {
  return {
    runId: `run-${clientId}`,
    clientId,
    client: {
      id: clientId,
      ws: { readyState: 1, send: vi.fn() } as any,
      isAlive: true,
      isLocal: false,
      authenticated: true,
    },
    pendingPermissions: new Map(),
    db: {} as any,
    sessionId: `session-${clientId}`,
    projectId: 'project-1',
    assistantMessageId: `assistant-${clientId}`,
    fullContent: '',
    collectedToolCalls: [],
    contentBlocks: [],
    sessionType: 'regular',
    workspaceRoot: '/tmp',
    rememberedDecisions: new Map(),
    allowedOutsideWorkspaceRoots: new Set(),
    startedAt: Date.now(),
    lastActivityAt: Date.now(),
    recentToolCalls: [],
    loopHeartbeatStreak: 0,
    eventSeq: 0,
    completed,
  };
}

describe('handleChannelClosed', () => {
  it('keeps active runs alive (does not remove them from activeRuns)', () => {
    const activeRuns = new Map<string, ActiveRun>([
      ['run-1', createRun('channel-1')],
      ['run-2', createRun('channel-2')],
    ]);

    handleChannelClosed('channel-1', activeRuns);

    // Run should still be in the map — not cancelled
    expect(activeRuns.has('run-1')).toBe(true);
    expect(activeRuns.has('run-2')).toBe(true);
    expect(activeRuns.size).toBe(2);
  });

  it('logs orphaned runs', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const activeRuns = new Map<string, ActiveRun>([
      ['run-1', createRun('channel-1')],
    ]);

    handleChannelClosed('channel-1', activeRuns);

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining('keeping alive for reconnect'),
    );
    logSpy.mockRestore();
  });

  it('does not log when no active runs for channel', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const activeRuns = new Map<string, ActiveRun>([
      ['run-1', createRun('channel-2')],
    ]);

    handleChannelClosed('channel-1', activeRuns);

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('ignores completed runs', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const activeRuns = new Map<string, ActiveRun>([
      ['run-1', createRun('channel-1', true)],
    ]);

    handleChannelClosed('channel-1', activeRuns);

    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });
});
