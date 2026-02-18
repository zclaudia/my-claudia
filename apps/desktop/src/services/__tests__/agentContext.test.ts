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

describe('buildAgentContext', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns context with local backend info', () => {
    mockGatewayState.mockReturnValue({
      discoveredBackends: [],
      gatewayUrl: null,
      localBackendId: null,
      gatewaySecret: null,
    });
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
    mockGatewayState.mockReturnValue({
      discoveredBackends: [],
      gatewayUrl: null,
      localBackendId: null,
      gatewaySecret: null,
    });
    mockServerState.mockReturnValue({
      servers: [{ id: 'local-1', name: 'Local', address: 'localhost:3100' }],
    });

    const result = buildAgentContext();

    expect(result).toContain('http://localhost:3100');
  });

  it('marks local backend as "(local, this server)" when matched', () => {
    mockGatewayState.mockReturnValue({
      discoveredBackends: [{ backendId: 'backend-abc', isLocal: true, online: true, name: 'Local' }],
      gatewayUrl: 'wss://gw.example.com',
      localBackendId: 'backend-abc',
      gatewaySecret: null,
    });
    mockServerState.mockReturnValue({
      servers: [{ id: 'local-1', name: 'My Server', address: 'http://localhost:3100' }],
    });

    const result = buildAgentContext();

    expect(result).toContain('(local, this server)');
  });

  it('includes remote gateway backends', () => {
    mockGatewayState.mockReturnValue({
      discoveredBackends: [
        { backendId: 'remote-1', isLocal: false, online: true, name: 'Remote Server' },
      ],
      gatewayUrl: 'wss://gw.example.com',
      localBackendId: null,
      gatewaySecret: null,
    });
    mockServerState.mockReturnValue({ servers: [] });

    const result = buildAgentContext();

    expect(result).toContain('Remote Server');
    expect(result).toContain('Backend ID: `remote-1`');
    expect(result).toContain('https://gw.example.com/api/proxy/remote-1');
  });

  it('skips offline remote backends', () => {
    mockGatewayState.mockReturnValue({
      discoveredBackends: [
        { backendId: 'offline-1', isLocal: false, online: false, name: 'Offline Server' },
      ],
      gatewayUrl: 'wss://gw.example.com',
      localBackendId: null,
      gatewaySecret: null,
    });
    mockServerState.mockReturnValue({ servers: [] });

    const result = buildAgentContext();

    expect(result).not.toContain('Offline Server');
  });

  it('includes auth header info when gateway secret exists and remote backends are present', () => {
    mockGatewayState.mockReturnValue({
      discoveredBackends: [
        { backendId: 'remote-1', isLocal: false, online: true, name: 'Remote' },
      ],
      gatewayUrl: 'wss://gw.example.com',
      localBackendId: null,
      gatewaySecret: 'my-secret-token',
    });
    mockServerState.mockReturnValue({ servers: [] });

    const result = buildAgentContext();

    expect(result).toContain('Authentication');
    expect(result).toContain('Authorization: Bearer my-secret-token');
  });

  it('omits auth section when no remote backends exist', () => {
    mockGatewayState.mockReturnValue({
      discoveredBackends: [
        { backendId: 'local-1', isLocal: true, online: true, name: 'Local' },
      ],
      gatewayUrl: 'wss://gw.example.com',
      localBackendId: 'local-1',
      gatewaySecret: 'secret',
    });
    mockServerState.mockReturnValue({
      servers: [{ id: 'local-1', name: 'Local', address: 'http://localhost:3100' }],
    });

    const result = buildAgentContext();

    expect(result).not.toContain('Authentication');
  });

  it('converts ws:// gateway URL to http://', () => {
    mockGatewayState.mockReturnValue({
      discoveredBackends: [
        { backendId: 'remote-1', isLocal: false, online: true, name: 'Remote' },
      ],
      gatewayUrl: 'ws://gw.local:8080',
      localBackendId: null,
      gatewaySecret: null,
    });
    mockServerState.mockReturnValue({ servers: [] });

    const result = buildAgentContext();

    expect(result).toContain('http://gw.local:8080/api/proxy/remote-1');
  });

  it('skips gateway-prefixed servers in local section', () => {
    mockGatewayState.mockReturnValue({
      discoveredBackends: [],
      gatewayUrl: null,
      localBackendId: null,
      gatewaySecret: null,
    });
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
});
