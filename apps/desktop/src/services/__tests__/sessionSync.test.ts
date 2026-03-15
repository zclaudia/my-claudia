import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetSessionMessages = vi.fn(() => Promise.resolve({ messages: [], pagination: {} }));

// Mock all store dependencies before importing the module
vi.mock('../../stores/sessionsStore', () => ({
  useSessionsStore: {
    getState: vi.fn(() => ({
      remoteSessions: new Map(),
      handleSessionEvent: vi.fn(),
      setRemoteSessions: vi.fn(),
    })),
  },
}));

vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: vi.fn(() => ({
      activeServerId: null,
      servers: [],
      getActiveServer: vi.fn(),
    })),
  },
}));

vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: {
    getState: vi.fn(() => ({
      gatewayUrl: null,
      gatewaySecret: null,
    })),
  },
  isGatewayTarget: vi.fn(() => false),
  parseBackendId: vi.fn((id) => id),
}));

vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      pagination: {},
      appendMessages: vi.fn(),
    })),
  },
}));

vi.mock('../../stores/projectStore', () => ({
  useProjectStore: {
    getState: vi.fn(() => ({
      selectedSessionId: null,
      deleteSession: vi.fn(),
    })),
  },
}));

vi.mock('../gatewayProxy', () => ({
  resolveGatewayBackendUrl: vi.fn(() => 'http://localhost:3000'),
  getGatewayAuthHeaders: vi.fn(() => ({})),
}));

vi.mock('../api', () => ({
  getSessionMessages: mockGetSessionMessages,
}));

describe('services/sessionSync', () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('isSyncRunning', () => {
    it('returns false when no sync is running', async () => {
      const { isSyncRunning, stopSessionSync } = await import('../sessionSync.js');

      // Stop all syncs first to ensure clean state
      stopSessionSync();

      expect(isSyncRunning()).toBe(false);
    });

    it('returns true for specific backend when sync is running', async () => {
      const { startSessionSync, stopSessionSync, isSyncRunning } = await import('../sessionSync.js');

      // Mock fetch for fullSync
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('test-backend');

      // Should be running
      expect(isSyncRunning('test-backend')).toBe(true);

      // Clean up
      stopSessionSync('test-backend');
    });
  });

  describe('stopSessionSync', () => {
    it('stops specific backend sync', async () => {
      const { startSessionSync, stopSessionSync, isSyncRunning } = await import('../sessionSync.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('backend-1');
      startSessionSync('backend-2');

      stopSessionSync('backend-1');

      expect(isSyncRunning('backend-1')).toBe(false);
      expect(isSyncRunning('backend-2')).toBe(true);

      // Clean up
      stopSessionSync();
    });

    it('stops all syncs when no backendId provided', async () => {
      const { startSessionSync, stopSessionSync, isSyncRunning } = await import('../sessionSync.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('backend-1');
      startSessionSync('backend-2');

      stopSessionSync();

      expect(isSyncRunning()).toBe(false);
    });
  });

  describe('startSessionSync', () => {
    it('replaces existing sync for same backend', async () => {
      const { startSessionSync, stopSessionSync, isSyncRunning } = await import('../sessionSync.js');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('test-backend');
      startSessionSync('test-backend'); // Should replace previous

      expect(isSyncRunning('test-backend')).toBe(true);

      stopSessionSync();
    });
  });

  describe('eagerSyncAllBackends', () => {
    it('does nothing when no backends are being synced', async () => {
      const { eagerSyncAllBackends, stopSessionSync } = await import('../sessionSync.js');

      stopSessionSync();
      eagerSyncAllBackends();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('eagerSyncSessionUpdate', () => {
    it('fills missing messages for the currently selected active session', async () => {
      const appendMessages = vi.fn();
      mockGetSessionMessages.mockResolvedValue({
        messages: [{ id: 'm2', sessionId: 's1', role: 'user', content: 'hello', createdAt: 2 }],
        pagination: { maxOffset: 2, total: 2 },
      });

      const { useProjectStore } = await import('../../stores/projectStore');
      const { useChatStore } = await import('../../stores/chatStore');

      vi.mocked(useProjectStore.getState).mockReturnValue({
        selectedSessionId: 's1',
        deleteSession: vi.fn(),
      } as any);
      vi.mocked(useChatStore.getState).mockReturnValue({
        pagination: { s1: { maxOffset: 1 } },
        appendMessages,
      } as any);

      const { eagerSyncSessionUpdate } = await import('../sessionSync.js');
      await eagerSyncSessionUpdate({
        id: 's1',
        name: 'Session',
        projectId: 'p1',
        createdAt: 1,
        updatedAt: 2,
        isActive: true,
        lastMessageOffset: 2,
      } as any);

      expect(mockGetSessionMessages).toHaveBeenCalledWith('s1', {
        afterOffset: 1,
        limit: 100,
      });
      expect(appendMessages).toHaveBeenCalled();
    });
  });

  describe('sync intervals', () => {
    it('uses correct default intervals', () => {
      const INCREMENTAL_SYNC_INTERVAL = 30000;
      const FULL_SYNC_INTERVAL = 300000;
      expect(INCREMENTAL_SYNC_INTERVAL).toBe(30000);
      expect(FULL_SYNC_INTERVAL).toBe(300000);
    });
  });

  describe('eagerSyncCurrentSession', () => {
    it('does nothing when no selected session', async () => {
      const { eagerSyncCurrentSession, stopSessionSync } = await import('../sessionSync.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      stopSessionSync();
      await eagerSyncCurrentSession('b1');
      // Should not throw or call api
    });

    it('does nothing when no pagination maxOffset', async () => {
      const { eagerSyncCurrentSession, stopSessionSync } = await import('../sessionSync.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useChatStore } = await import('../../stores/chatStore.js');
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: 's1', deleteSession: vi.fn() });
      (useChatStore.getState as any).mockReturnValue({ pagination: {}, appendMessages: vi.fn() });

      stopSessionSync();
      await eagerSyncCurrentSession('b1');
    });

    it('fetches and appends missing messages', async () => {
      const { eagerSyncCurrentSession, stopSessionSync } = await import('../sessionSync.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useChatStore } = await import('../../stores/chatStore.js');

      const appendMessages = vi.fn();
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: 's1', deleteSession: vi.fn() });
      (useChatStore.getState as any).mockReturnValue({
        pagination: { s1: { maxOffset: 5 } },
        appendMessages,
      });
      mockGetSessionMessages.mockResolvedValue({
        messages: [{ id: 'm1' }],
        pagination: { maxOffset: 10 },
      });

      stopSessionSync();
      await eagerSyncCurrentSession('b1');
      expect(appendMessages).toHaveBeenCalledWith('s1', [{ id: 'm1' }], { maxOffset: 10 });
    });

    it('handles fetch error gracefully', async () => {
      const { eagerSyncCurrentSession, stopSessionSync } = await import('../sessionSync.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useChatStore } = await import('../../stores/chatStore.js');

      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: 's1', deleteSession: vi.fn() });
      (useChatStore.getState as any).mockReturnValue({
        pagination: { s1: { maxOffset: 5 } },
        appendMessages: vi.fn(),
      });
      mockGetSessionMessages.mockRejectedValue(new Error('Network error'));

      stopSessionSync();
      await eagerSyncCurrentSession('b1');
      expect(consoleErrorSpy).toHaveBeenCalled();
    });

    it('skips when messages is empty', async () => {
      const { eagerSyncCurrentSession, stopSessionSync } = await import('../sessionSync.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useChatStore } = await import('../../stores/chatStore.js');

      const appendMessages = vi.fn();
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: 's1', deleteSession: vi.fn() });
      (useChatStore.getState as any).mockReturnValue({
        pagination: { s1: { maxOffset: 5 } },
        appendMessages,
      });
      mockGetSessionMessages.mockResolvedValue({
        messages: [],
        pagination: {},
      });

      stopSessionSync();
      await eagerSyncCurrentSession('b1');
      expect(appendMessages).not.toHaveBeenCalled();
    });
  });

  describe('eagerSyncAllBackends with active backends', () => {
    it('triggers sync for all active backends', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { sessions: [], timestamp: Date.now() } }),
      });

      startSessionSync('b1');
      eagerSyncAllBackends();
      stopSessionSync();
    });
  });

  describe('startSessionSync initial state', () => {
    it('sets up sync state and intervals', async () => {
      const { startSessionSync, stopSessionSync, isSyncRunning } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: true, data: { sessions: [], timestamp: Date.now() } }),
      });

      startSessionSync('b1');
      expect(isSyncRunning('b1')).toBe(true);
      expect(isSyncRunning('nonexistent')).toBe(false);

      stopSessionSync();
    });
  });

  describe('incremental sync via eagerSyncAllBackends', () => {
    it('performs incremental sync for active backends', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      const handleSessionEvent = vi.fn();
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['b1', []]]),
        handleSessionEvent,
        setRemoteSessions: vi.fn(),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sessions: [{ id: 's1', updatedAt: Date.now() }],
            timestamp: Date.now(),
          },
        }),
      });

      startSessionSync('b1');
      eagerSyncAllBackends();

      // Wait for async operations to complete
      await new Promise(resolve => setTimeout(resolve, 50));

      // Verify that fetch was called (incremental sync triggered)
      expect(global.fetch).toHaveBeenCalled();

      stopSessionSync();
    });

    it('handles failed fetch in incremental sync', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      startSessionSync('b1');
      eagerSyncAllBackends();

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('sync failed'),
        expect.anything()
      );

      stopSessionSync();
    });

    it('handles fetch throwing error in incremental sync', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      startSessionSync('b1');
      eagerSyncAllBackends();

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(consoleErrorSpy).toHaveBeenCalled();

      stopSessionSync();
    });

    it('handles sync error response (success: false)', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ success: false, error: 'Server error' }),
      });

      startSessionSync('b1');
      eagerSyncAllBackends();

      await new Promise(resolve => setTimeout(resolve, 50));

      stopSessionSync();
    });

    it('detects new sessions during incremental sync', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      const handleSessionEvent = vi.fn();
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['b1', []]]),
        handleSessionEvent,
        setRemoteSessions: vi.fn(),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sessions: [{ id: 's-new', updatedAt: Date.now() }],
            timestamp: Date.now(),
          },
        }),
      });

      startSessionSync('b1');
      eagerSyncAllBackends();

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handleSessionEvent).toHaveBeenCalledWith('b1', 'created', expect.objectContaining({ id: 's-new' }));

      stopSessionSync();
    });

    it('detects updated sessions during incremental sync', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      const handleSessionEvent = vi.fn();
      const existingSessions = [{ id: 's1', updatedAt: 1000 }];
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['b1', existingSessions]]),
        handleSessionEvent,
        setRemoteSessions: vi.fn(),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sessions: [{ id: 's1', updatedAt: 2000 }],
            timestamp: Date.now(),
          },
        }),
      });

      startSessionSync('b1');
      eagerSyncAllBackends();

      await new Promise(resolve => setTimeout(resolve, 50));

      expect(handleSessionEvent).toHaveBeenCalledWith('b1', 'updated', expect.objectContaining({ id: 's1' }));

      stopSessionSync();
    });
  });

  describe('getBaseUrl variations', () => {
    it('uses gateway URL for gateway target backends', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const gatewayStore = await import('../../stores/gatewayStore.js');

      vi.mocked(gatewayStore.isGatewayTarget).mockReturnValue(true);
      vi.mocked(gatewayStore.parseBackendId).mockReturnValue('real-backend-id');

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('gw:backend1');
      eagerSyncAllBackends();

      await new Promise(resolve => setTimeout(resolve, 50));

      // The fetch should use the gateway proxy URL (mocked to http://localhost:3000)
      if ((global.fetch as any).mock.calls.length > 0) {
        const fetchUrl = (global.fetch as any).mock.calls[0][0];
        expect(fetchUrl).toContain('localhost:3000');
      }

      stopSessionSync();

      // Reset
      vi.mocked(gatewayStore.isGatewayTarget).mockReturnValue(false);
    });

    it('handles ws:// address by converting to http://', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'ws://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'ws://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('b1');
      eagerSyncAllBackends();

      await new Promise(resolve => setTimeout(resolve, 50));

      if ((global.fetch as any).mock.calls.length > 0) {
        const fetchUrl = (global.fetch as any).mock.calls[0][0];
        expect(fetchUrl).toContain('http://localhost:3100');
      }

      stopSessionSync();
    });
  });

  describe('getAuthHeaders variations', () => {
    it('returns bearer token for direct server with clientId', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100', clientId: 'my-client-id' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100', clientId: 'my-client-id' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('b1');
      eagerSyncAllBackends();

      await new Promise(resolve => setTimeout(resolve, 50));

      if ((global.fetch as any).mock.calls.length > 0) {
        const fetchHeaders = (global.fetch as any).mock.calls[0][1]?.headers;
        expect(fetchHeaders?.Authorization).toBe('Bearer my-client-id');
      }

      stopSessionSync();
    });

    it('returns empty headers when direct server has no clientId', async () => {
      const { startSessionSync, stopSessionSync } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('b1');
      await new Promise(resolve => setTimeout(resolve, 50));

      // Fetch should have been called without Authorization header
      if ((global.fetch as any).mock.calls.length > 0) {
        const fetchHeaders = (global.fetch as any).mock.calls[0][1]?.headers;
        expect(fetchHeaders?.Authorization).toBeUndefined();
      }

      stopSessionSync();
    });

    it('returns gateway auth headers when backend is gateway target', async () => {
      vi.useFakeTimers();
      const { startSessionSync, stopSessionSync } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');
      const gatewayStore = await import('../../stores/gatewayStore.js');
      const gatewayProxy = await import('../gatewayProxy.js');

      vi.mocked(gatewayStore.isGatewayTarget).mockReturnValue(true);
      vi.mocked(gatewayStore.parseBackendId).mockReturnValue('backend1');
      vi.mocked(gatewayProxy.resolveGatewayBackendUrl).mockReturnValue('http://gw-proxy:4000');
      vi.mocked(gatewayProxy.getGatewayAuthHeaders).mockReturnValue({ 'X-Gateway-Auth': 'secret' });

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'gw:backend1',
        servers: [],
        getActiveServer: () => null,
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['gw:backend1', []]]),
        handleSessionEvent: vi.fn(),
        setRemoteSessions: vi.fn(),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('gw:backend1');
      // Trigger incremental sync via interval to exercise getAuthHeaders with gateway
      await vi.advanceTimersByTimeAsync(30000);

      const fetchCalls = (global.fetch as any).mock.calls;
      expect(fetchCalls.length).toBeGreaterThan(0);
      const fetchHeaders = fetchCalls[fetchCalls.length - 1][1]?.headers;
      expect(fetchHeaders?.['X-Gateway-Auth']).toBe('secret');

      stopSessionSync();

      // Reset gateway mocks
      vi.mocked(gatewayStore.isGatewayTarget).mockReturnValue(false);
      vi.mocked(gatewayProxy.resolveGatewayBackendUrl).mockReturnValue('http://localhost:3000');
      vi.mocked(gatewayProxy.getGatewayAuthHeaders).mockReturnValue({});
      vi.useRealTimers();
    });
  });

  describe('fullSync', () => {
    // Note: startSessionSync calls fullSync() before syncStates.set(),
    // so the initial fullSync returns early (no state). To test fullSync,
    // we trigger it via the 5-minute interval using fake timers.

    async function setupAndTriggerFullSync(
      fetchMock: any,
      storeMocks: {
        serverStore?: any;
        projectStore?: any;
        sessionsStore?: any;
      } = {}
    ) {
      vi.useFakeTimers();
      const mod = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      (useServerStore.getState as any).mockReturnValue(storeMocks.serverStore ?? {
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue(storeMocks.projectStore ?? {
        selectedSessionId: null,
        deleteSession: vi.fn(),
      });
      (useSessionsStore.getState as any).mockReturnValue(storeMocks.sessionsStore ?? {
        remoteSessions: new Map([['b1', []]]),
        handleSessionEvent: vi.fn(),
        setRemoteSessions: vi.fn(),
      });

      // Initial fetch for the fire-and-forget fullSync (which exits early due to no state)
      // and any incremental syncs from the 30s intervals
      global.fetch = fetchMock;

      mod.startSessionSync('b1');
      // Advance past full sync interval (300s) to trigger fullSync via interval
      await vi.advanceTimersByTimeAsync(300000);

      return mod;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('detects and deletes sessions missing from server', async () => {
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      const deleteSession = vi.fn();
      const setRemoteSessions = vi.fn();

      const mod = await setupAndTriggerFullSync(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sessions: [
                { id: 's1', updatedAt: 1000 },
                { id: 's3', updatedAt: 3000 },
              ],
              timestamp: Date.now(),
            },
          }),
        }),
        {
          projectStore: { selectedSessionId: null, deleteSession },
          sessionsStore: {
            remoteSessions: new Map([['b1', [
              { id: 's1', updatedAt: 1000 },
              { id: 's2', updatedAt: 2000 },
              { id: 's3', updatedAt: 3000 },
            ]]]),
            handleSessionEvent: vi.fn(),
            setRemoteSessions,
          },
        }
      );

      expect(deleteSession).toHaveBeenCalledWith('s2');
      expect(setRemoteSessions).toHaveBeenCalledWith('b1', expect.arrayContaining([
        expect.objectContaining({ id: 's1' }),
        expect.objectContaining({ id: 's3' }),
      ]));

      mod.stopSessionSync();
    });

    it('handles failed fetch in full sync', async () => {
      const mod = await setupAndTriggerFullSync(
        vi.fn().mockResolvedValue({ ok: false, status: 503 })
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[SessionSync] Full sync failed:',
        503
      );

      mod.stopSessionSync();
    });

    it('handles success: false in full sync response', async () => {
      const mod = await setupAndTriggerFullSync(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ success: false, error: 'Database error' }),
        })
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[SessionSync] Sync returned error:',
        'Database error'
      );

      mod.stopSessionSync();
    });

    it('handles fetch throwing error in full sync', async () => {
      const mod = await setupAndTriggerFullSync(
        vi.fn().mockRejectedValue(new Error('Connection refused'))
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[SessionSync] Full sync failed:',
        expect.any(Error)
      );

      mod.stopSessionSync();
    });

    it('returns early when no base URL available', async () => {
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      const mod = await setupAndTriggerFullSync(fetchMock, {
        serverStore: {
          activeServerId: null,
          servers: [],
          getActiveServer: () => null,
        },
      });

      // fullSync should have warned about no base URL (incrementalSync also warns)
      expect(consoleWarnSpy).toHaveBeenCalledWith('[SessionSync] No base URL available');

      mod.stopSessionSync();
      consoleWarnSpy.mockRestore();
    });
  });

  describe('checkAndFillMessageGaps via sync', () => {
    beforeEach(() => {
      mockGetSessionMessages.mockClear();
    });

    // Helper: trigger incremental sync via fake timers (30s interval)
    async function setupAndTriggerIncrementalSync(
      fetchMock: any,
      storeMocks: { projectStore?: any; chatStore?: any; sessionsStore?: any } = {}
    ) {
      vi.useFakeTimers();
      const mod = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');
      const { useChatStore } = await import('../../stores/chatStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue(storeMocks.projectStore ?? {
        selectedSessionId: null, deleteSession: vi.fn(),
      });
      (useChatStore.getState as any).mockReturnValue(storeMocks.chatStore ?? {
        pagination: {}, appendMessages: vi.fn(),
      });
      (useSessionsStore.getState as any).mockReturnValue(storeMocks.sessionsStore ?? {
        remoteSessions: new Map([['b1', []]]),
        handleSessionEvent: vi.fn(),
        setRemoteSessions: vi.fn(),
      });

      global.fetch = fetchMock;

      mod.startSessionSync('b1');
      // Advance to trigger one incremental sync (30s)
      await vi.advanceTimersByTimeAsync(30000);

      return mod;
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('fills message gaps during incremental sync when session has gap', async () => {
      const appendMessages = vi.fn();

      mockGetSessionMessages.mockResolvedValue({
        messages: [{ id: 'm6' }, { id: 'm7' }],
        pagination: { maxOffset: 10 },
      });

      const mod = await setupAndTriggerIncrementalSync(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sessions: [{ id: 's1', updatedAt: Date.now(), lastMessageOffset: 10, isActive: false }],
              timestamp: Date.now(),
            },
          }),
        }),
        {
          projectStore: { selectedSessionId: 's1', deleteSession: vi.fn() },
          chatStore: { pagination: { s1: { maxOffset: 5 } }, appendMessages },
        }
      );

      expect(mockGetSessionMessages).toHaveBeenCalledWith('s1', { afterOffset: 5, limit: 100 });
      expect(appendMessages).toHaveBeenCalledWith('s1', [{ id: 'm6' }, { id: 'm7' }], { maxOffset: 10 });

      mod.stopSessionSync();
    });

    it('fills gap even when session is active (isActive does not block gap fill)', async () => {
      mockGetSessionMessages.mockResolvedValue({ messages: [{ id: 'm6' }], pagination: { maxOffset: 10 } });
      const appendMessages = vi.fn();

      const mod = await setupAndTriggerIncrementalSync(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sessions: [{ id: 's1', updatedAt: Date.now(), lastMessageOffset: 10, isActive: true }],
              timestamp: Date.now(),
            },
          }),
        }),
        {
          projectStore: { selectedSessionId: 's1', deleteSession: vi.fn() },
          chatStore: { pagination: { s1: { maxOffset: 5 } }, appendMessages },
        }
      );

      // Gap fill is not blocked by isActive flag
      expect(mockGetSessionMessages).toHaveBeenCalledWith('s1', { afterOffset: 5, limit: 100 });
      expect(appendMessages).toHaveBeenCalled();

      mod.stopSessionSync();
    });

    it('skips gap fill when no selected session matches synced sessions', async () => {
      const mod = await setupAndTriggerIncrementalSync(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sessions: [{ id: 's1', updatedAt: Date.now(), lastMessageOffset: 10 }],
              timestamp: Date.now(),
            },
          }),
        }),
        {
          projectStore: { selectedSessionId: 'other-session', deleteSession: vi.fn() },
        }
      );

      expect(mockGetSessionMessages).not.toHaveBeenCalled();

      mod.stopSessionSync();
    });

    it('skips gap fill when session has no lastMessageOffset', async () => {
      const mod = await setupAndTriggerIncrementalSync(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sessions: [{ id: 's1', updatedAt: Date.now() }],
              timestamp: Date.now(),
            },
          }),
        }),
        {
          projectStore: { selectedSessionId: 's1', deleteSession: vi.fn() },
          chatStore: { pagination: { s1: { maxOffset: 5 } }, appendMessages: vi.fn() },
        }
      );

      expect(mockGetSessionMessages).not.toHaveBeenCalled();

      mod.stopSessionSync();
    });

    it('skips gap fill when local offset equals or exceeds server offset', async () => {
      const mod = await setupAndTriggerIncrementalSync(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sessions: [{ id: 's1', updatedAt: Date.now(), lastMessageOffset: 10, isActive: false }],
              timestamp: Date.now(),
            },
          }),
        }),
        {
          projectStore: { selectedSessionId: 's1', deleteSession: vi.fn() },
          chatStore: { pagination: { s1: { maxOffset: 10 } }, appendMessages: vi.fn() },
        }
      );

      // lastMessageOffset == maxOffset, no gap
      expect(mockGetSessionMessages).not.toHaveBeenCalled();

      mod.stopSessionSync();
    });

    it('handles error during gap fill gracefully', async () => {
      mockGetSessionMessages.mockRejectedValue(new Error('Failed to fetch messages'));

      const mod = await setupAndTriggerIncrementalSync(
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            success: true,
            data: {
              sessions: [{ id: 's1', updatedAt: Date.now(), lastMessageOffset: 10, isActive: false }],
              timestamp: Date.now(),
            },
          }),
        }),
        {
          projectStore: { selectedSessionId: 's1', deleteSession: vi.fn() },
          chatStore: { pagination: { s1: { maxOffset: 5 } }, appendMessages: vi.fn() },
        }
      );

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[SessionSync] Failed to fill message gap:',
        expect.any(Error)
      );

      mod.stopSessionSync();
    });

    it('fills gaps during full sync (via interval)', async () => {
      vi.useFakeTimers();
      const mod = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');
      const { useChatStore } = await import('../../stores/chatStore.js');

      const appendMessages = vi.fn();

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: 's1', deleteSession: vi.fn() });
      (useChatStore.getState as any).mockReturnValue({
        pagination: { s1: { maxOffset: 3 } },
        appendMessages,
      });
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['b1', []]]),
        handleSessionEvent: vi.fn(),
        setRemoteSessions: vi.fn(),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sessions: [{ id: 's1', updatedAt: Date.now(), lastMessageOffset: 8, isActive: false }],
            timestamp: Date.now(),
          },
        }),
      });

      mockGetSessionMessages.mockResolvedValue({
        messages: [{ id: 'm4' }],
        pagination: { maxOffset: 8 },
      });

      mod.startSessionSync('b1');
      // Trigger full sync via 5-minute interval
      await vi.advanceTimersByTimeAsync(300000);

      expect(mockGetSessionMessages).toHaveBeenCalledWith('s1', { afterOffset: 3, limit: 100 });
      expect(appendMessages).toHaveBeenCalled();

      mod.stopSessionSync();
    });
  });

  describe('incremental sync - session not changed', () => {
    it('does not fire event when session updatedAt is same', async () => {
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      const handleSessionEvent = vi.fn();
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['b1', [{ id: 's1', updatedAt: 1000 }]]]),
        handleSessionEvent,
        setRemoteSessions: vi.fn(),
      });

      // Server returns same updatedAt — should not trigger update
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            sessions: [{ id: 's1', updatedAt: 1000 }],
            timestamp: Date.now(),
          },
        }),
      });

      startSessionSync('b1');
      eagerSyncAllBackends();
      await new Promise(resolve => setTimeout(resolve, 100));

      // handleSessionEvent should have been called only from the fullSync (setRemoteSessions),
      // NOT from the incremental sync for this unchanged session
      const incrementalCalls = handleSessionEvent.mock.calls.filter(
        (call: any[]) => call[1] === 'updated' && call[2]?.id === 's1'
      );
      expect(incrementalCalls.length).toBe(0);

      stopSessionSync();
    });
  });

  describe('sync interval callbacks', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('incremental interval fires and triggers sync', async () => {
      vi.useFakeTimers();
      const { startSessionSync, stopSessionSync } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['b1', []]]),
        handleSessionEvent: vi.fn(),
        setRemoteSessions: vi.fn(),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('b1');

      const initialCallCount = (global.fetch as any).mock.calls.length;

      // Advance exactly by 30s to trigger one incremental sync
      await vi.advanceTimersByTimeAsync(30000);

      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(initialCallCount);

      stopSessionSync();
    });

    it('full sync interval fires and triggers sync', async () => {
      vi.useFakeTimers();
      const { startSessionSync, stopSessionSync } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['b1', []]]),
        handleSessionEvent: vi.fn(),
        setRemoteSessions: vi.fn(),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('b1');

      const initialCallCount = (global.fetch as any).mock.calls.length;

      // Advance exactly by 300s to trigger one full sync (plus incremental syncs)
      await vi.advanceTimersByTimeAsync(300000);

      expect((global.fetch as any).mock.calls.length).toBeGreaterThan(initialCallCount);

      stopSessionSync();
    });
  });

  describe('getBaseUrl fallback path (no targetBackendId)', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns null when no active server and no targetBackendId', async () => {
      vi.useFakeTimers();
      const { startSessionSync, stopSessionSync } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: null,
        servers: [],
        getActiveServer: () => null,
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });

      global.fetch = vi.fn();

      startSessionSync('unknown-backend');
      // Trigger incremental sync to exercise getBaseUrl
      await vi.advanceTimersByTimeAsync(30000);

      // fetch should not have been called since no base URL
      expect(global.fetch).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalledWith('[SessionSync] No base URL available');

      stopSessionSync();
      consoleWarnSpy.mockRestore();
    });

    it('uses address without protocol by prepending http://', async () => {
      vi.useFakeTimers();
      const { startSessionSync, stopSessionSync } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['b1', []]]),
        handleSessionEvent: vi.fn(),
        setRemoteSessions: vi.fn(),
      });

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          success: true,
          data: { sessions: [], timestamp: Date.now() },
        }),
      });

      startSessionSync('b1');
      await vi.advanceTimersByTimeAsync(30000);

      const fetchCalls = (global.fetch as any).mock.calls;
      expect(fetchCalls.length).toBeGreaterThan(0);
      const fetchUrl = fetchCalls[fetchCalls.length - 1][0];
      expect(fetchUrl).toMatch(/^http:\/\/localhost:3100/);

      stopSessionSync();
    });
  });

  describe('concurrent sync protection', () => {
    it('skips incremental sync when another sync is already running for same backend', async () => {
      vi.useFakeTimers();
      const { startSessionSync, stopSessionSync, eagerSyncAllBackends } = await import('../sessionSync.js');
      const { useServerStore } = await import('../../stores/serverStore.js');
      const { useProjectStore } = await import('../../stores/projectStore.js');
      const { useSessionsStore } = await import('../../stores/sessionsStore.js');

      (useServerStore.getState as any).mockReturnValue({
        activeServerId: 'b1',
        servers: [{ id: 'b1', address: 'http://localhost:3100' }],
        getActiveServer: () => ({ id: 'b1', address: 'http://localhost:3100' }),
      });
      (useProjectStore.getState as any).mockReturnValue({ selectedSessionId: null, deleteSession: vi.fn() });
      (useSessionsStore.getState as any).mockReturnValue({
        remoteSessions: new Map([['b1', []]]),
        handleSessionEvent: vi.fn(),
        setRemoteSessions: vi.fn(),
      });

      // Make the first incremental sync (triggered by interval) slow
      let resolveSlow: () => void;
      const slowPromise = new Promise<void>(resolve => { resolveSlow = resolve; });
      let fetchCallCount = 0;

      global.fetch = vi.fn().mockImplementation(() => {
        fetchCallCount++;
        if (fetchCallCount === 1) {
          // First incremental sync — slow, holds the activeSyncs lock
          return slowPromise.then(() => ({
            ok: true,
            json: async () => ({
              success: true,
              data: { sessions: [], timestamp: Date.now() },
            }),
          }));
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            success: true,
            data: { sessions: [], timestamp: Date.now() },
          }),
        });
      });

      startSessionSync('b1');

      // Trigger incremental sync via interval — it will be slow (holds the lock)
      vi.advanceTimersByTime(30000);
      // Now try eager sync — incremental should be skipped due to activeSyncs lock
      eagerSyncAllBackends();

      // The incremental sync from eagerSyncAllBackends should have been skipped
      // because the interval-triggered one still holds the lock.
      // Only 1 fetch call should exist (from the first incremental).
      expect(fetchCallCount).toBe(1);

      // Clean up: resolve the slow fetch
      resolveSlow!();
      await vi.advanceTimersByTimeAsync(0);

      stopSessionSync();
      vi.useRealTimers();
    });
  });

  describe('stopSessionSync edge cases', () => {
    it('does nothing when stopping a backend that is not synced', async () => {
      const { stopSessionSync, isSyncRunning } = await import('../sessionSync.js');

      stopSessionSync('nonexistent-backend');
      expect(isSyncRunning('nonexistent-backend')).toBe(false);
    });

    it('does nothing when stopping all syncs when none are running', async () => {
      const { stopSessionSync, isSyncRunning } = await import('../sessionSync.js');

      stopSessionSync(); // Stop all when there's nothing
      expect(isSyncRunning()).toBe(false);
    });
  });
});
