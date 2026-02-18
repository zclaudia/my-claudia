import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildAgentContext } from '../agentContext';

// Mock stores
vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: {
    getState: vi.fn(),
  },
}));

vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: vi.fn(),
  },
}));

import { useGatewayStore } from '../../stores/gatewayStore';
import { useServerStore } from '../../stores/serverStore';

const mockGatewayState = useGatewayStore.getState as ReturnType<typeof vi.fn>;
const mockServerState = useServerStore.getState as ReturnType<typeof vi.fn>;

/** Helper to create a desktop-mode gateway state (no direct config) */
function desktopGatewayState(overrides: Record<string, unknown> = {}) {
  return {
    discoveredBackends: [],
    gatewayUrl: null,
    localBackendId: null,
    gatewaySecret: null,
    hasDirectConfig: () => false,
    ...overrides,
  };
}

/** Helper to create a mobile-mode gateway state (has direct config) */
function mobileGatewayState(overrides: Record<string, unknown> = {}) {
  return {
    discoveredBackends: [],
    gatewayUrl: 'wss://gw.example.com',
    localBackendId: null,
    gatewaySecret: 'secret',
    hasDirectConfig: () => true,
    ...overrides,
  };
}

describe('buildAgentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- Desktop mode tests ----

  it('returns context with local backend info', () => {
    mockGatewayState.mockReturnValue(desktopGatewayState());
    mockServerState.mockReturnValue({
      servers: [{ id: 'local-1', name: 'My Server', address: 'http://localhost:3100' }],
    });

    const result = buildAgentContext();

    expect(result).toContain('Connected Backends');
    expect(result).toContain('My Server');
    expect(result).toContain('http://localhost:3100');
    expect(result).toContain('curl -s http://localhost:3100/api/projects');
  });

  it('adds http:// prefix when address has no protocol', () => {
    mockGatewayState.mockReturnValue(desktopGatewayState());
    mockServerState.mockReturnValue({
      servers: [{ id: 'local-1', name: 'Local', address: 'localhost:3100' }],
    });

    const result = buildAgentContext();

    expect(result).toContain('http://localhost:3100');
  });

  it('marks local backend as "(local, this server)" when matched', () => {
    mockGatewayState.mockReturnValue(desktopGatewayState({
      discoveredBackends: [{ backendId: 'backend-abc', isLocal: true, online: true, name: 'Local' }],
      gatewayUrl: 'wss://gw.example.com',
      localBackendId: 'backend-abc',
    }));
    mockServerState.mockReturnValue({
      servers: [{ id: 'local-1', name: 'My Server', address: 'http://localhost:3100' }],
    });

    const result = buildAgentContext();

    expect(result).toContain('(local, this server)');
  });

  it('includes remote gateway backends', () => {
    mockGatewayState.mockReturnValue(desktopGatewayState({
      discoveredBackends: [
        { backendId: 'remote-1', isLocal: false, online: true, name: 'Remote Server' },
      ],
      gatewayUrl: 'wss://gw.example.com',
    }));
    mockServerState.mockReturnValue({ servers: [] });

    const result = buildAgentContext();

    expect(result).toContain('Remote Server');
    expect(result).toContain('Backend ID: `remote-1`');
    expect(result).toContain('https://gw.example.com/api/proxy/remote-1');
  });

  it('skips offline remote backends', () => {
    mockGatewayState.mockReturnValue(desktopGatewayState({
      discoveredBackends: [
        { backendId: 'offline-1', isLocal: false, online: false, name: 'Offline Server' },
      ],
      gatewayUrl: 'wss://gw.example.com',
    }));
    mockServerState.mockReturnValue({ servers: [] });

    const result = buildAgentContext();

    expect(result).not.toContain('Offline Server');
  });

  it('includes auth header info when gateway secret exists and remote backends are present', () => {
    mockGatewayState.mockReturnValue(desktopGatewayState({
      discoveredBackends: [
        { backendId: 'remote-1', isLocal: false, online: true, name: 'Remote' },
      ],
      gatewayUrl: 'wss://gw.example.com',
      gatewaySecret: 'my-secret-token',
    }));
    mockServerState.mockReturnValue({ servers: [] });

    const result = buildAgentContext();

    expect(result).toContain('Authentication');
    expect(result).toContain('Authorization: Bearer my-secret-token');
  });

  it('omits auth section when no remote backends exist (desktop)', () => {
    mockGatewayState.mockReturnValue(desktopGatewayState({
      discoveredBackends: [
        { backendId: 'local-1', isLocal: true, online: true, name: 'Local' },
      ],
      gatewayUrl: 'wss://gw.example.com',
      localBackendId: 'local-1',
      gatewaySecret: 'secret',
    }));
    mockServerState.mockReturnValue({
      servers: [{ id: 'local-1', name: 'Local', address: 'http://localhost:3100' }],
    });

    const result = buildAgentContext();

    expect(result).not.toContain('Authentication');
  });

  it('converts ws:// gateway URL to http://', () => {
    mockGatewayState.mockReturnValue(desktopGatewayState({
      discoveredBackends: [
        { backendId: 'remote-1', isLocal: false, online: true, name: 'Remote' },
      ],
      gatewayUrl: 'ws://gw.local:8080',
    }));
    mockServerState.mockReturnValue({ servers: [] });

    const result = buildAgentContext();

    expect(result).toContain('http://gw.local:8080/api/proxy/remote-1');
  });

  it('skips gateway-prefixed servers in local section', () => {
    mockGatewayState.mockReturnValue(desktopGatewayState());
    mockServerState.mockReturnValue({
      servers: [
        { id: 'gw:abc', name: 'Gateway Server', address: 'http://remote:3100' },
        { id: 'local-1', name: 'Local', address: 'http://localhost:3100' },
      ],
    });

    const result = buildAgentContext();

    expect(result).toContain('Local');
    expect(result).not.toContain('Gateway Server');
  });

  // ---- Mobile mode tests ----

  it('mobile: excludes localhost server from context', () => {
    mockGatewayState.mockReturnValue(mobileGatewayState({
      discoveredBackends: [
        { backendId: 'coder-server', isLocal: false, online: true, name: 'Coder Server' },
      ],
    }));
    mockServerState.mockReturnValue({
      servers: [{ id: 'local', name: 'Local Server', address: 'localhost:3100' }],
    });

    const result = buildAgentContext();

    expect(result).not.toContain('localhost:3100');
    expect(result).not.toContain('Local Server');
    expect(result).toContain('Coder Server');
  });

  it('mobile: includes isLocal gateway backend (not filtered)', () => {
    mockGatewayState.mockReturnValue(mobileGatewayState({
      discoveredBackends: [
        { backendId: 'my-backend', isLocal: true, online: true, name: 'My Backend' },
      ],
    }));
    mockServerState.mockReturnValue({
      servers: [{ id: 'local', name: 'Local Server', address: 'localhost:3100' }],
    });

    const result = buildAgentContext();

    expect(result).not.toContain('localhost:3100');
    expect(result).toContain('My Backend');
    expect(result).toContain('Backend ID: `my-backend`');
    expect(result).toContain('https://gw.example.com/api/proxy/my-backend');
  });

  it('mobile: includes auth section for gateway backends', () => {
    mockGatewayState.mockReturnValue(mobileGatewayState({
      discoveredBackends: [
        { backendId: 'my-backend', isLocal: true, online: true, name: 'My Backend' },
      ],
    }));
    mockServerState.mockReturnValue({ servers: [] });

    const result = buildAgentContext();

    expect(result).toContain('Authentication');
    expect(result).toContain('Authorization: Bearer secret');
  });
});
