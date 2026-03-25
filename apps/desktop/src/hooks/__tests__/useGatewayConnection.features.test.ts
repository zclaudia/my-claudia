// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGatewayConnection } from '../useGatewayConnection';

const { mockTransportInstance, MockGatewayTransport } = vi.hoisted(() => {
  const mockTransportInstance = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    isConnected: vi.fn(() => true),
    getRegistryItems: vi.fn(() => new Map()),
    getChannelId: vi.fn(() => undefined),
    openChannel: vi.fn(),
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
  discoveredBackends: [],
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
    getState: () => ({
      setRemoteSessions: vi.fn(),
      handleSessionEvent: vi.fn(),
      clearBackendSessions: vi.fn(),
      clearAllSessions: vi.fn(),
    }),
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
  stopSessionSync: vi.fn(),
}));

describe('useGatewayConnection feature propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockTransportInstance.isConnected.mockReturnValue(true);
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
  });
});
