// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGatewayConnection } from '../useGatewayConnection';
import { startSessionSync, stopSessionSync } from '../../services/sessionSync';
import { isGatewayTarget } from '../../stores/gatewayStore';

const { mockTransportInstance, MockGatewayTransport } = vi.hoisted(() => {
  const mockTransportInstance = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => true),
    getRegistryItems: vi.fn(() => new Map()),
    getChannelId: vi.fn(() => undefined),
    openChannel: vi.fn(),
    openSessionStream: vi.fn(),
    closeSessionStream: vi.fn(),
    catchUpContent: vi.fn(),
    subscribeCatalog: vi.fn(),
    sendToBackend: vi.fn(),
  };

  return {
    mockTransportInstance,
    MockGatewayTransport: vi.fn(function MockGatewayTransport() {
      return mockTransportInstance;
    }),
  };
});

vi.mock('../transport/GatewayTransport', () => ({
  GatewayTransport: MockGatewayTransport,
}));

const gatewayStoreState = {
  gatewayUrl: 'http://gateway.example.com',
  gatewaySecret: 'secret',
  isConnected: false,
  localBackendId: null as string | null,
  discoveredBackends: [] as Array<{ backendId: string; name: string }>,
  setConnected: vi.fn(),
  setDiscoveredBackends: vi.fn(),
  setBackendAuthStatus: vi.fn(),
  syncFromServer: vi.fn(),
  directGatewayUrl: null as string | null,
  directGatewaySecret: null as string | null,
};

vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: Object.assign(
    vi.fn(() => gatewayStoreState),
    {
      getState: () => gatewayStoreState,
    },
  ),
  toGatewayServerId: vi.fn((id: string) => `gateway:${id}`),
  isGatewayTarget: vi.fn(() => false),
  parseBackendId: vi.fn((id: string) => id.replace('gateway:', '')),
}));

const serverStoreState = {
  activeServerId: null as string | null,
  setServerConnectionStatus: vi.fn(),
  setServerLocalConnection: vi.fn(),
  setServerFeatures: vi.fn(),
  setServerPublicKey: vi.fn(),
  updateLastConnected: vi.fn(),
};

const sessionsStoreState = {
  remoteSessions: new Map<string, any[]>(),
  setRemoteSessions: vi.fn(),
  handleSessionEvent: vi.fn(),
  clearBackendSessions: vi.fn(),
  clearAllSessions: vi.fn(),
};
const projectStoreState = {
  selectedSessionId: null as string | null,
};
const chatStoreState = {
  pagination: {} as Record<string, { maxOffset?: number }>,
  appendMessages: vi.fn(),
};

vi.mock('../../stores/serverStore', () => ({
  useServerStore: Object.assign(
    vi.fn(() => serverStoreState),
    {
      getState: () => serverStoreState,
    },
  ),
}));

vi.mock('../../stores/sessionsStore', () => ({
  useSessionsStore: {
    getState: () => sessionsStoreState,
  },
}));
vi.mock('../../stores/projectStore', () => ({
  useProjectStore: vi.fn((selector?: any) => selector ? selector(projectStoreState) : projectStoreState),
}));
vi.mock('../../stores/chatStore', () => ({
  useChatStore: {
    getState: () => chatStoreState,
  },
}));

vi.mock('../../services/api', () => ({
  getServerGatewayStatus: vi.fn(() =>
    Promise.resolve({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      discoveredBackends: [],
      backendId: null,
      connected: false,
    }),
  ),
}));

vi.mock('../../services/messageHandler', () => ({
  handleServerMessage: vi.fn(),
}));

vi.mock('../../services/sessionSync', () => ({
  startSessionSync: vi.fn(),
  stopSessionSync: vi.fn(),
}));

describe('useGatewayConnection feature propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransportInstance.isConnected.mockReturnValue(true);
    gatewayStoreState.discoveredBackends = [];
    serverStoreState.activeServerId = null;
    sessionsStoreState.remoteSessions = new Map();
    projectStoreState.selectedSessionId = null;
    chatStoreState.pagination = {};
    vi.mocked(isGatewayTarget).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('stores gateway backend capabilities as server features when a channel opens', () => {
    renderHook(() => useGatewayConnection());

    const transportConfig = MockGatewayTransport.mock.calls[0]?.[0];
    expect(transportConfig).toBeDefined();

    act(() => {
      transportConfig.onChannelOpened('backend-1', 'channel-1', 1, ['providerCommands', 'providerCapabilities']);
    });

    expect(serverStoreState.setServerFeatures).toHaveBeenCalledWith('gateway:backend-1', [
      'providerCommands',
      'providerCapabilities',
    ]);
    expect(startSessionSync).toHaveBeenCalledWith('gateway:backend-1');
  });

  it('creates missing sessions for catalog upserts and stops sync on channel close', () => {
    const remoteSessions = new Map<string, any[]>();
    remoteSessions.set('backend-1', []);
    sessionsStoreState.remoteSessions = remoteSessions;

    renderHook(() => useGatewayConnection());

    const transportConfig = MockGatewayTransport.mock.calls[0]?.[0];
    expect(transportConfig).toBeDefined();

    act(() => {
      transportConfig.onCatalogEvent('backend-1', 1, 'upsert', {
        sessionId: 'session-1',
        title: 'New Session',
        createdAt: 1,
        updatedAt: 2,
        activeRunStatus: 'idle',
      });
    });

    expect(sessionsStoreState.handleSessionEvent).toHaveBeenCalledWith(
      'backend-1',
      'created',
      expect.objectContaining({ id: 'session-1', name: 'New Session' }),
    );

    act(() => {
      transportConfig.onChannelClosed('channel-1', 'backend-1', 'backend_offline');
    });

    expect(stopSessionSync).toHaveBeenCalledWith('gateway:backend-1');
  });

  it('opens a session stream and requests catch-up for the selected gateway session', () => {
    serverStoreState.activeServerId = 'gateway:backend-1';
    projectStoreState.selectedSessionId = 'session-1';
    chatStoreState.pagination = { 'session-1': { maxOffset: 12 } };
    mockTransportInstance.getChannelId.mockReturnValue('channel-1');
    vi.mocked(isGatewayTarget).mockReturnValue(true);

    renderHook(() => useGatewayConnection());

    const transportConfig = MockGatewayTransport.mock.calls[0]?.[0];
    act(() => {
      transportConfig.onChannelOpened('backend-1', 'channel-1', 1, []);
    });

    expect(mockTransportInstance.openSessionStream).toHaveBeenCalledWith('channel-1', 'session-1');
    expect(mockTransportInstance.catchUpContent).toHaveBeenCalledWith('channel-1', 'session-1', 12);
  });

  it('applies content patches to the chat store', () => {
    renderHook(() => useGatewayConnection());

    const transportConfig = MockGatewayTransport.mock.calls[0]?.[0];
    act(() => {
      transportConfig.onContentPatch('channel-1', 'session-1', [{
        messageId: 'm-1',
        sessionId: 'session-1',
        offset: 9,
        role: 'assistant',
        createdAt: 123,
        content: 'tail',
      }], 9);
    });

    expect(chatStoreState.appendMessages).toHaveBeenCalledWith(
      'session-1',
      [expect.objectContaining({ id: 'm-1', sessionId: 'session-1', role: 'assistant', createdAt: 123, content: 'tail' })],
      { maxOffset: 9 },
    );
  });
});
