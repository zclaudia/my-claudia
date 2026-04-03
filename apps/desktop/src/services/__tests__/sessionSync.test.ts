import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockGetSessionMessages,
  mockResolveGatewayBackendUrl,
  mockGetGatewayAuthHeaders,
  sessionsState,
  serverState,
  facadeState,
  gatewayState,
  chatState,
  projectState,
} = vi.hoisted(() => ({
  mockGetSessionMessages: vi.fn(),
  mockResolveGatewayBackendUrl: vi.fn((backendId: string) => `http://gateway.test/${backendId}`),
  mockGetGatewayAuthHeaders: vi.fn(() => ({ Authorization: 'Bearer test-secret' })),
  sessionsState: {
    remoteSessions: new Map<string, any[]>(),
    handleSessionEvent: vi.fn(),
    setRemoteSessions: vi.fn(),
  },
  serverState: {
    activeServerId: 'local-standalone',
    connections: {},
    localServerPort: 3100,
  },
  facadeState: {
    localBackendId: 'local-standalone',
    backends: [
      {
        backendId: 'local-standalone',
        name: 'Local',
        online: true,
        runtimeState: 'ready',
        isThisInstance: true,
      },
    ],
  },
  gatewayState: {
    gatewayUrl: null,
    gatewaySecret: null,
    directGatewayUrl: '',
    directGatewaySecret: '',
  },
  chatState: {
    pagination: {},
    appendMessages: vi.fn(),
    mergeMessages: vi.fn(),
  },
  projectState: {
    selectedSessionId: null as string | null,
    deleteSession: vi.fn(),
  },
}));

vi.mock('../../stores/sessionsStore', () => ({
  useSessionsStore: {
    getState: vi.fn(() => sessionsState),
  },
}));

vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: vi.fn(() => serverState),
  },
}));

vi.mock('../../stores/facadeStore', () => ({
  useFacadeStore: {
    getState: vi.fn(() => facadeState),
  },
}));

vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: {
    getState: vi.fn(() => gatewayState),
  },
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(() => chatState),
  },
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => projectState),
  },
}));

vi.mock('../gatewayProxy', () => ({
  resolveGatewayBackendUrl: (...args: any[]) => mockResolveGatewayBackendUrl(...args),
  getGatewayAuthHeaders: (...args: any[]) => mockGetGatewayAuthHeaders(...args),
}));

vi.mock('../api', () => ({
  getSessionMessages: (...args: any[]) => mockGetSessionMessages(...args),
}));

function createFetchResponse(data: unknown, ok = true) {
  return Promise.resolve({
    ok,
    json: async () => data,
  });
}

function resetMockState() {
  sessionsState.remoteSessions = new Map();
  sessionsState.handleSessionEvent.mockReset();
  sessionsState.setRemoteSessions.mockReset();

  serverState.activeServerId = 'local-standalone';
  serverState.connections = {};
  serverState.localServerPort = 3100;

  facadeState.localBackendId = 'local-standalone';
  facadeState.backends = [
    {
      backendId: 'local-standalone',
      name: 'Local',
      online: true,
      runtimeState: 'ready',
      isThisInstance: true,
    },
  ];

  gatewayState.gatewayUrl = null;
  gatewayState.gatewaySecret = null;
  gatewayState.directGatewayUrl = '';
  gatewayState.directGatewaySecret = '';

  chatState.pagination = {};
  chatState.appendMessages.mockReset();
  chatState.mergeMessages.mockReset();

  projectState.selectedSessionId = null;
  projectState.deleteSession.mockReset();

  mockGetSessionMessages.mockReset();
  mockResolveGatewayBackendUrl.mockClear();
  mockGetGatewayAuthHeaders.mockClear();
}

describe('services/sessionSync', () => {
  beforeEach(() => {
    vi.resetModules();
    resetMockState();
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe('syncBackendCatalog', () => {
    it('performs full sync for local backend and replaces sessions', async () => {
      sessionsState.remoteSessions = new Map([
        ['local-standalone', [{ id: 'deleted-session', updatedAt: 1 }]],
      ]);
      (global.fetch as any).mockImplementation(() =>
        createFetchResponse({
          success: true,
          data: {
            sessions: [{ id: 'session-1', updatedAt: 2 }],
            timestamp: 123,
          },
        })
      );

      const { syncBackendCatalog } = await import('../sessionSync.js');
      const result = await syncBackendCatalog('local-standalone', 'full');

      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3100/api/sessions/sync?since=0',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
      expect(projectState.deleteSession).toHaveBeenCalledWith('deleted-session');
      expect(sessionsState.setRemoteSessions).toHaveBeenCalledWith('local-standalone', [
        { id: 'session-1', updatedAt: 2 },
      ]);
      expect(result).toEqual({
        completed: true,
        sessions: [{ id: 'session-1', updatedAt: 2 }],
      });
    });

    it('performs delta sync for remote backend and emits created and updated events', async () => {
      gatewayState.directGatewayUrl = 'ws://gateway.test';
      gatewayState.directGatewaySecret = 'secret';
      facadeState.localBackendId = 'local-standalone';
      facadeState.backends = [
        ...facadeState.backends,
        { backendId: 'remote-1', name: 'Remote', online: true, runtimeState: 'ready', isThisInstance: false },
      ];
      sessionsState.remoteSessions = new Map([
        ['remote-1', [{ id: 'existing', updatedAt: 1 }]],
      ]);
      (global.fetch as any).mockImplementation(() =>
        createFetchResponse({
          success: true,
          data: {
            sessions: [
              { id: 'new-session', updatedAt: 3 },
              { id: 'existing', updatedAt: 5 },
            ],
            timestamp: 456,
          },
        })
      );

      const { syncBackendCatalog } = await import('../sessionSync.js');
      const result = await syncBackendCatalog('remote-1', 'delta');

      expect(mockResolveGatewayBackendUrl).toHaveBeenCalledWith('remote-1');
      expect(mockGetGatewayAuthHeaders).toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        'http://gateway.test/remote-1/api/sessions/sync?since=0',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer test-secret',
          }),
        })
      );
      expect(sessionsState.handleSessionEvent).toHaveBeenCalledWith(
        'remote-1',
        'created',
        expect.objectContaining({ id: 'new-session' })
      );
      expect(sessionsState.handleSessionEvent).toHaveBeenCalledWith(
        'remote-1',
        'updated',
        expect.objectContaining({ id: 'existing' })
      );
      expect(result).toEqual({
        completed: true,
        sessions: [
          { id: 'new-session', updatedAt: 3 },
          { id: 'existing', updatedAt: 5 },
        ],
      });
    });

    it('returns incomplete result when no local request URL is available', async () => {
      serverState.localServerPort = 0;

      const { syncBackendCatalog } = await import('../sessionSync.js');
      const result = await syncBackendCatalog('local-standalone', 'full');

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result).toEqual({ completed: false, sessions: [] });
    });
  });

  describe('eagerSyncCurrentSession', () => {
    it('appends missing messages for the selected session', async () => {
      projectState.selectedSessionId = 'session-1';
      chatState.pagination = { 'session-1': { maxOffset: 5 } };
      mockGetSessionMessages.mockResolvedValue({
        messages: [{ id: 'message-6' }],
        pagination: { maxOffset: 6 },
      });

      const { eagerSyncCurrentSession } = await import('../sessionSync.js');
      await eagerSyncCurrentSession('backend-1');

      expect(mockGetSessionMessages).toHaveBeenCalledWith('session-1', {
        afterOffset: 5,
        limit: 100,
      });
      expect(chatState.appendMessages).toHaveBeenCalledWith(
        'session-1',
        [{ id: 'message-6' }],
        { maxOffset: 6 }
      );
    });

    it('skips when there is no selected session or pagination offset', async () => {
      const { eagerSyncCurrentSession } = await import('../sessionSync.js');

      await eagerSyncCurrentSession('backend-1');
      projectState.selectedSessionId = 'session-1';
      await eagerSyncCurrentSession('backend-1');

      expect(mockGetSessionMessages).not.toHaveBeenCalled();
      expect(chatState.appendMessages).not.toHaveBeenCalled();
    });
  });

  describe('recoverCurrentSessionTail', () => {
    it('merges the latest message window for the active session', async () => {
      projectState.selectedSessionId = 'session-1';
      serverState.activeServerId = 'backend-1';
      mockGetSessionMessages.mockResolvedValue({
        messages: [{ id: 'message-10' }],
        pagination: { maxOffset: 10 },
      });

      const { recoverCurrentSessionTail } = await import('../sessionSync.js');
      await recoverCurrentSessionTail('backend-1', 'session-1');

      expect(mockGetSessionMessages).toHaveBeenCalledWith('session-1', { limit: 100 });
      expect(chatState.mergeMessages).toHaveBeenCalledWith(
        'session-1',
        [{ id: 'message-10' }],
        { maxOffset: 10 }
      );
    });

    it('coalesces concurrent recovery calls and runs one trailing retry', async () => {
      projectState.selectedSessionId = 'session-1';
      serverState.activeServerId = 'backend-1';
      vi.useFakeTimers();

      let resolveFirst: ((value: unknown) => void) | null = null;
      mockGetSessionMessages
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            })
        )
        .mockResolvedValueOnce({
          messages: [{ id: 'message-11' }],
          pagination: { maxOffset: 11 },
        });

      const { recoverCurrentSessionTail } = await import('../sessionSync.js');
      const first = recoverCurrentSessionTail('backend-1', 'session-1');
      const second = recoverCurrentSessionTail('backend-1', 'session-1');
      const third = recoverCurrentSessionTail('backend-1', 'session-1');

      expect(mockGetSessionMessages).toHaveBeenCalledTimes(1);

      resolveFirst?.({
        messages: [{ id: 'message-10' }],
        pagination: { maxOffset: 10 },
      });
      await first;
      await second;
      await third;
      await vi.runAllTimersAsync();

      expect(mockGetSessionMessages).toHaveBeenCalledTimes(2);
      expect(chatState.mergeMessages).toHaveBeenCalledTimes(2);
    });

    it('skips recovery when session or backend does not match current selection', async () => {
      projectState.selectedSessionId = 'session-1';
      serverState.activeServerId = 'backend-1';

      const { recoverCurrentSessionTail } = await import('../sessionSync.js');
      await recoverCurrentSessionTail('backend-2', 'session-1');
      await recoverCurrentSessionTail('backend-1', 'session-2');

      expect(mockGetSessionMessages).not.toHaveBeenCalled();
      expect(chatState.mergeMessages).not.toHaveBeenCalled();
    });
  });
});
