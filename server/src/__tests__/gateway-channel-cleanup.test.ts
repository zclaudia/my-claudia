import { describe, expect, it, vi } from 'vitest';
import { cancelRunsForClosedChannel } from '../domains/gateway/gateway-channel-cleanup.js';
import type { ActiveRun } from '../ws/types.js';

function createRun(clientId: string): ActiveRun {
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
  };
}

describe('cancelRunsForClosedChannel', () => {
  it('cancels only runs bound to the closed channel with gateway-specific reason', () => {
    const activeRuns = new Map<string, ActiveRun>([
      ['run-1', createRun('channel-1')],
      ['run-2', createRun('channel-2')],
    ]);
    const cancelRun = vi.fn();

    cancelRunsForClosedChannel('channel-1', activeRuns, cancelRun);

    expect(cancelRun).toHaveBeenCalledTimes(1);
    expect(cancelRun).toHaveBeenCalledWith('run-1', {
      clientError: 'Gateway connection was interrupted',
      logLabel: 'Gateway-disconnected run',
    });
  });
});
