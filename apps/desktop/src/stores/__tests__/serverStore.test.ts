import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useServerStore } from '../serverStore';

vi.mock('../gatewayStore', () => ({
  useGatewayStore: {
    getState: () => ({
      gatewayUrl: 'https://gateway.test',
      discoveredBackends: [
        { backendId: 'b1', name: 'Backend 1' },
      ],
    }),
  },
  isGatewayTarget: (id: string | null) => id?.startsWith('gw:') ?? false,
  parseBackendId: (id: string) => id.replace('gw:', ''),
}));

describe('serverStore', () => {
  beforeEach(() => {
    useServerStore.setState({
      servers: [{ id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 }],
      activeServerId: 'local',
      connections: {},
      localServerPort: null,
      connectionStatus: 'disconnected',
      connectionError: null,
      isLocalConnection: null,
    });
  });

  describe('setServers', () => {
    it('sets server list', () => {
      const servers = [
        { id: 's1', name: 'S1', address: 'a:1', isDefault: true, createdAt: 0 },
        { id: 's2', name: 'S2', address: 'a:2', isDefault: false, createdAt: 0 },
      ];
      useServerStore.getState().setServers(servers);
      expect(useServerStore.getState().servers).toEqual(servers);
    });

    it('guards against invalid input', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      useServerStore.getState().setServers(null as any);
      expect(useServerStore.getState().servers).toHaveLength(1); // unchanged
      useServerStore.getState().setServers(undefined as any);
      expect(useServerStore.getState().servers).toHaveLength(1);
      warn.mockRestore();
    });

    it('resets activeServerId if not in new list', () => {
      useServerStore.setState({ activeServerId: 'nonexistent' });
      useServerStore.getState().setServers([
        { id: 's1', name: 'S1', address: 'a:1', isDefault: true, createdAt: 0 },
      ]);
      expect(useServerStore.getState().activeServerId).toBe('s1');
    });

    it('preserves localServerPort in server address', () => {
      useServerStore.setState({ localServerPort: 9999 });
      useServerStore.getState().setServers([
        { id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 },
      ]);
      expect(useServerStore.getState().servers[0].address).toBe('localhost:9999');
    });

    it('does not reset activeServerId for gateway targets', () => {
      useServerStore.setState({ activeServerId: 'gw:b1' });
      useServerStore.getState().setServers([
        { id: 's1', name: 'S1', address: 'a:1', isDefault: true, createdAt: 0 },
      ]);
      expect(useServerStore.getState().activeServerId).toBe('gw:b1');
    });
  });

  describe('setActiveServer', () => {
    it('sets active server and syncs legacy state', () => {
      useServerStore.setState({
        connections: { s1: { status: 'connected', error: null, isLocalConnection: true, features: [] } },
      });
      useServerStore.getState().setActiveServer('s1');
      const s = useServerStore.getState();
      expect(s.activeServerId).toBe('s1');
      expect(s.connectionStatus).toBe('connected');
      expect(s.isLocalConnection).toBe(true);
    });

    it('sets null active server', () => {
      useServerStore.getState().setActiveServer(null);
      expect(useServerStore.getState().activeServerId).toBeNull();
      expect(useServerStore.getState().connectionStatus).toBe('disconnected');
    });
  });

  describe('setConnectionStatus', () => {
    it('updates per-server and legacy state', () => {
      useServerStore.getState().setConnectionStatus('connected');
      const s = useServerStore.getState();
      expect(s.connectionStatus).toBe('connected');
      expect(s.connections.local?.status).toBe('connected');
    });

    it('updates with error', () => {
      useServerStore.getState().setConnectionStatus('error', 'timeout');
      expect(useServerStore.getState().connectionError).toBe('timeout');
    });

    it('handles no active server', () => {
      useServerStore.setState({ activeServerId: null });
      useServerStore.getState().setConnectionStatus('connecting');
      expect(useServerStore.getState().connectionStatus).toBe('connecting');
    });
  });

  describe('setIsLocalConnection', () => {
    it('updates per-server and legacy state', () => {
      useServerStore.getState().setIsLocalConnection(true);
      expect(useServerStore.getState().isLocalConnection).toBe(true);
      expect(useServerStore.getState().connections.local?.isLocalConnection).toBe(true);
    });

    it('handles no active server', () => {
      useServerStore.setState({ activeServerId: null });
      useServerStore.getState().setIsLocalConnection(false);
      expect(useServerStore.getState().isLocalConnection).toBe(false);
    });
  });

  describe('setServerConnectionStatus', () => {
    it('sets per-server connection status', () => {
      useServerStore.getState().setServerConnectionStatus('s1', 'connected');
      expect(useServerStore.getState().connections.s1.status).toBe('connected');
    });

    it('updates legacy state for active server', () => {
      useServerStore.getState().setServerConnectionStatus('local', 'connected');
      expect(useServerStore.getState().connectionStatus).toBe('connected');
    });

    it('does not update legacy state for non-active server', () => {
      useServerStore.getState().setServerConnectionStatus('other', 'connected');
      expect(useServerStore.getState().connectionStatus).toBe('disconnected');
    });
  });

  describe('setServerLocalConnection', () => {
    it('sets per-server local connection', () => {
      useServerStore.getState().setServerLocalConnection('s1', true);
      expect(useServerStore.getState().connections.s1.isLocalConnection).toBe(true);
    });

    it('updates legacy state for active server', () => {
      useServerStore.getState().setServerLocalConnection('local', true);
      expect(useServerStore.getState().isLocalConnection).toBe(true);
    });
  });

  describe('setServerFeatures', () => {
    it('sets features on server connection', () => {
      useServerStore.getState().setServerFeatures('s1', ['worktrees', 'plugins'] as any);
      expect(useServerStore.getState().connections.s1.features).toEqual(['worktrees', 'plugins']);
    });
  });

  describe('setServerPublicKey', () => {
    it('sets and clears public key', () => {
      useServerStore.getState().setServerPublicKey('s1', 'key-data');
      expect(useServerStore.getState().connections.s1.publicKey).toBe('key-data');
      useServerStore.getState().setServerPublicKey('s1', undefined);
      expect(useServerStore.getState().connections.s1.publicKey).toBeUndefined();
    });
  });

  describe('updateLastConnected', () => {
    it('updates lastConnected timestamp', () => {
      const before = Date.now();
      useServerStore.getState().updateLastConnected('local');
      expect(useServerStore.getState().servers[0].lastConnected).toBeGreaterThanOrEqual(before);
    });
  });

  describe('setLocalServerPort', () => {
    it('updates port and local server address', () => {
      useServerStore.getState().setLocalServerPort(5555);
      expect(useServerStore.getState().localServerPort).toBe(5555);
      expect(useServerStore.getState().servers[0].address).toBe('localhost:5555');
    });
  });

  describe('getActiveServer', () => {
    it('returns active server', () => {
      const server = useServerStore.getState().getActiveServer();
      expect(server?.id).toBe('local');
    });

    it('returns undefined when no active server', () => {
      useServerStore.setState({ activeServerId: null });
      expect(useServerStore.getState().getActiveServer()).toBeUndefined();
    });

    it('returns gateway virtual server', () => {
      useServerStore.setState({ activeServerId: 'gw:b1' });
      const server = useServerStore.getState().getActiveServer();
      expect(server?.name).toBe('Backend 1');
    });

    it('applies localServerPort to local server', () => {
      useServerStore.setState({ localServerPort: 7777 });
      const server = useServerStore.getState().getActiveServer();
      expect(server?.address).toBe('localhost:7777');
    });
  });

  describe('getDefaultServer', () => {
    it('returns default server', () => {
      const server = useServerStore.getState().getDefaultServer();
      expect(server?.isDefault).toBe(true);
    });

    it('applies localServerPort', () => {
      useServerStore.setState({ localServerPort: 8888 });
      const server = useServerStore.getState().getDefaultServer();
      expect(server?.address).toBe('localhost:8888');
    });
  });

  describe('getServerConnection / getActiveServerConnection', () => {
    it('returns connection for server', () => {
      useServerStore.setState({
        connections: { s1: { status: 'connected', error: null, isLocalConnection: true, features: [] } },
      });
      expect(useServerStore.getState().getServerConnection('s1')?.status).toBe('connected');
    });

    it('returns undefined for unknown server', () => {
      expect(useServerStore.getState().getServerConnection('unknown')).toBeUndefined();
    });

    it('returns active server connection', () => {
      useServerStore.setState({
        connections: { local: { status: 'connected', error: null, isLocalConnection: true, features: [] } },
      });
      expect(useServerStore.getState().getActiveServerConnection()?.status).toBe('connected');
    });

    it('returns undefined when no active server', () => {
      useServerStore.setState({ activeServerId: null });
      expect(useServerStore.getState().getActiveServerConnection()).toBeUndefined();
    });
  });

  describe('activeServerSupports', () => {
    it('returns true when feature is supported', () => {
      useServerStore.setState({
        connections: { local: { status: 'connected', error: null, isLocalConnection: true, features: ['worktrees'] as any } },
      });
      expect(useServerStore.getState().activeServerSupports('worktrees' as any)).toBe(true);
    });

    it('returns false when feature not supported', () => {
      useServerStore.setState({
        connections: { local: { status: 'connected', error: null, isLocalConnection: true, features: [] } },
      });
      expect(useServerStore.getState().activeServerSupports('worktrees' as any)).toBe(false);
    });

    it('returns false when no active server', () => {
      useServerStore.setState({ activeServerId: null });
      expect(useServerStore.getState().activeServerSupports('worktrees' as any)).toBe(false);
    });

    it('returns false when no connection', () => {
      expect(useServerStore.getState().activeServerSupports('worktrees' as any)).toBe(false);
    });
  });
});
