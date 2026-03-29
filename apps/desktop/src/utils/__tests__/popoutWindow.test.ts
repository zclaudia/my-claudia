import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getConnectionParams } from '../popoutWindow';

const mockServerStoreState = {
  activeServerId: 'gw:remote-1',
};

const mockOwnershipStoreState = {
  getSessionBackendId: vi.fn(() => null),
};

vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: () => mockServerStoreState,
  },
}));

vi.mock('../../stores/ownershipStore', () => ({
  useOwnershipStore: {
    getState: () => mockOwnershipStoreState,
  },
}));

vi.mock('../../stores/facadeStore', () => ({
  useFacadeStore: {
    getState: () => ({
      backends: [
        { backendId: 'remote-1', name: 'Remote One' },
      ],
    }),
  },
}));

vi.mock('../../stores/gatewayStore', async () => {
  const actual = await vi.importActual<typeof import('../../stores/gatewayStore')>('../../stores/gatewayStore');
  return {
    ...actual,
    useGatewayStore: {
      getState: () => ({
        gatewayUrl: 'wss://gateway.example.com',
        gatewaySecret: 'secret-1',
      }),
    },
  };
});

vi.mock('../../services/api/base', () => ({
  getBaseUrlForBackend: vi.fn((backendId: string) => `http://example.test/${backendId}`),
  getAuthHeadersForBackend: vi.fn(() => ({ Authorization: 'Bearer token-1' })),
}));

vi.mock('../controlPlane', () => ({
  resolveCanonicalBackendId: (backendId: string | null | undefined, fallback: string | null = null) => backendId ?? fallback,
  resolveLocalBackendId: () => 'local-backend-1',
}));

describe('popoutWindow connection params', () => {
  beforeEach(() => {
    mockServerStoreState.activeServerId = 'gw:remote-1';
    mockOwnershipStoreState.getSessionBackendId.mockReset();
    mockOwnershipStoreState.getSessionBackendId.mockReturnValue(null);
  });

  it('canonicalizes gateway-prefixed active server ids', () => {
    const result = getConnectionParams();

    expect(result.serverId).toBe('remote-1');
    expect(result.serverUrl).toBe('http://example.test/remote-1');
    expect(result.serverName).toBe('Remote One');
  });

  it('prefers canonicalized ownership backend for session targets', () => {
    mockOwnershipStoreState.getSessionBackendId.mockReturnValue('gw:owner-1');

    const result = getConnectionParams({ sessionId: 'sess-1' });

    expect(result.serverId).toBe('owner-1');
  });
});
