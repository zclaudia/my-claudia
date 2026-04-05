// @vitest-environment jsdom

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGatewayConnection } from '../useGatewayConnection';

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockFacade,
  mockFacadeStoreState,
  mockGatewayStoreState,
  mockSetState,
} = vi.hoisted(() => {
  const mockFacade = {
    openBackend: vi.fn(),
    sendToBackend: vi.fn(),
    disconnect: vi.fn(),
  };

  const mockFacadeStoreState = {
    facade: mockFacade as any,
    backends: [] as any[],
    connectionState: 'connected' as string,
  };

  const mockGatewayStoreState: Record<string, any> = {
    gatewayUrl: null,
    gatewaySecret: null,
    isConnected: false,
    directGatewayUrl: null,
    directGatewaySecret: null,
  };

  const mockSetState = vi.fn((partial: any) => {
    const updates = typeof partial === 'function' ? partial(mockGatewayStoreState) : partial;
    Object.assign(mockGatewayStoreState, updates);
  });

  return { mockFacade, mockFacadeStoreState, mockGatewayStoreState, mockSetState };
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock('../../stores/facadeStore', () => ({
  useFacadeStore: Object.assign(
    vi.fn((selector?: any) =>
      selector ? selector(mockFacadeStoreState) : mockFacadeStoreState,
    ),
    {
      getState: () => mockFacadeStoreState,
    },
  ),
}));


vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: Object.assign(
    vi.fn(() => mockGatewayStoreState),
    {
      getState: () => mockGatewayStoreState,
      setState: mockSetState,
      subscribe: vi.fn(() => vi.fn()),
    },
  ),
  toGatewayServerId: vi.fn((id: string) => `gw:${id}`),
  isGatewayTarget: vi.fn((id: string) => id.startsWith('gw:')),
  parseBackendId: vi.fn((id: string) => id.replace('gw:', '')),
  GATEWAY_SERVER_PREFIX: 'gw:',
}));

vi.mock('../../services/api', () => ({
  getServerGatewayStatus: vi.fn(() =>
    Promise.resolve({
      enabled: false,
      gatewayUrl: null,
      gatewaySecret: null,
      connected: false,
    }),
  ),
}));

describe('useGatewayConnection facade delegation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockGatewayStoreState.gatewayUrl = null;
    mockGatewayStoreState.gatewaySecret = null;
    mockGatewayStoreState.isConnected = false;
    mockGatewayStoreState.directGatewayUrl = null;
    mockGatewayStoreState.directGatewaySecret = null;

    mockFacadeStoreState.facade = mockFacade as any;
    mockFacadeStoreState.backends = [];
    mockFacadeStoreState.connectionState = 'connected';

  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('delegates openChannel to facade.openBackend', () => {
    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.openChannel('backend-1');
    });

    expect(mockFacade.openBackend).toHaveBeenCalledWith('backend-1');
  });

  it('delegates sendToBackend to facade.sendToBackend', () => {
    const { result } = renderHook(() => useGatewayConnection());

    const message = { type: 'init' as const, projectId: 'p1' };
    act(() => {
      result.current.sendToBackend('backend-1', message as any);
    });

    expect(mockFacade.sendToBackend).toHaveBeenCalledWith('backend-1', message);
  });

  it('isBackendConnected uses isMobileBackendUsable', () => {
    mockFacadeStoreState.backends = [
      { backendId: 'b1', runtimeState: 'ready' },
    ];

    const { result } = renderHook(() => useGatewayConnection());

    expect(result.current.isBackendConnected('b1')).toBe(true);
  });

  it('isBackendConnected returns false when backend not ready', () => {
    mockFacadeStoreState.backends = [
      { backendId: 'b1', runtimeState: 'offline' },
    ];

    const { result } = renderHook(() => useGatewayConnection());

    expect(result.current.isBackendConnected('b1')).toBe(false);
  });

  it('disconnectGateway delegates to facade.disconnect', () => {
    const { result } = renderHook(() => useGatewayConnection());

    act(() => {
      result.current.disconnectGateway();
    });

    expect(mockFacade.disconnect).toHaveBeenCalled();
  });
});
