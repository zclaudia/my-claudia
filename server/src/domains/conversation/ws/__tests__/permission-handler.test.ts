import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handlePermissionDecision } from '../permission-handler.js';
import type { ActiveRun, ConnectedClient } from '../types.js';

vi.mock('../../../../utils/crypto.js', () => ({
  decryptCredential: vi.fn(() => {
    throw new Error('bad credential');
  }),
}));

describe('permission-handler', () => {
  let sendPrimary: ReturnType<typeof vi.fn>;
  let sendSecondary: ReturnType<typeof vi.fn>;
  let client: ConnectedClient;
  let otherClient: ConnectedClient;
  let run: ActiveRun;
  let activeRuns: Map<string, ActiveRun>;
  let connectedClients: Map<string, ConnectedClient>;
  let resolve: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    sendPrimary = vi.fn();
    sendSecondary = vi.fn();
    client = {
      id: 'client-1',
      ws: { readyState: 1, send: sendPrimary } as any,
      isAlive: true,
      isLocal: false,
      authenticated: true,
    };
    otherClient = {
      id: 'client-2',
      ws: { readyState: 1, send: sendSecondary } as any,
      isAlive: true,
      isLocal: false,
      authenticated: true,
    };
    resolve = vi.fn();
    run = {
      runId: 'run-1',
      clientId: 'client-1',
      client,
      pendingPermissions: new Map([
        ['req-1', {
          resolve,
          timeout: null,
          originalToolInput: { command: 'sudo ls' },
          originalRequest: {
            toolName: 'Bash',
            detail: 'sudo ls',
            timeoutSeconds: 30,
          },
        }],
      ]),
      db: { prepare: vi.fn(() => ({ run: vi.fn() })) } as any,
      sessionId: 'session-1',
      projectId: 'project-1',
      assistantMessageId: 'msg-1',
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
    activeRuns = new Map([['run-1', run]]);
    connectedClients = new Map([
      ['client-1', client],
      ['client-2', otherClient],
    ]);
  });

  it('broadcasts permission_resolved when credential decrypt fails', () => {
    handlePermissionDecision({
      type: 'permission_decision',
      requestId: 'req-1',
      allow: true,
      encryptedCredential: 'bad',
    }, activeRuns, connectedClients);

    expect(resolve).toHaveBeenCalledWith({
      behavior: 'deny',
      message: 'Failed to decrypt credential',
    });

    const primaryMessages = sendPrimary.mock.calls.map(([payload]) => JSON.parse(payload));
    const secondaryMessages = sendSecondary.mock.calls.map(([payload]) => JSON.parse(payload));

    expect(primaryMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'permission_resolved',
        requestId: 'req-1',
        sessionId: 'session-1',
        decision: 'deny',
      }),
    ]));
    expect(secondaryMessages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: 'permission_resolved',
        requestId: 'req-1',
        sessionId: 'session-1',
        decision: 'deny',
      }),
    ]));
  });
});
