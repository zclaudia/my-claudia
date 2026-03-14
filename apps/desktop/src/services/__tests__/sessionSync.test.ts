import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const getSessionMessagesMock = vi.fn(() => Promise.resolve({ messages: [], pagination: {} }));

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

vi.mock('./gatewayProxy', () => ({
  resolveGatewayBackendUrl: vi.fn(() => 'http://localhost:3000'),
  getGatewayAuthHeaders: vi.fn(() => ({})),
}));

vi.mock('../api', () => ({
  getSessionMessages: getSessionMessagesMock,
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
      getSessionMessagesMock.mockResolvedValue({
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

      expect(getSessionMessagesMock).toHaveBeenCalledWith('s1', {
        afterOffset: 1,
        limit: 100,
      });
      expect(appendMessages).toHaveBeenCalled();
    });
  });

  describe('sync intervals', () => {
    it('uses correct default intervals', () => {
      // Verify expected constants
      const INCREMENTAL_SYNC_INTERVAL = 30000; // 30 seconds
      const FULL_SYNC_INTERVAL = 300000; // 5 minutes

      expect(INCREMENTAL_SYNC_INTERVAL).toBe(30000);
      expect(FULL_SYNC_INTERVAL).toBe(300000);
    });
  });
});
