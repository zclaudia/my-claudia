import { describe, it, expect, beforeEach } from 'vitest';
import { useServerStore } from './serverStore';

describe('serverStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useServerStore.setState({
      servers: [
        {
          id: 'local',
          name: 'Local Server',
          address: 'localhost:3100',
          isDefault: true,
          createdAt: Date.now(),
        },
        {
          id: 'remote',
          name: 'Remote Server',
          address: '192.168.1.100:3100',
          isDefault: false,
          createdAt: Date.now(),
        },
      ],
      activeServerId: 'local',
      connectionStatus: 'disconnected',
      connectionError: null,
    });
  });

  describe('setActiveServer', () => {
    it('changes active server id', () => {
      useServerStore.getState().setActiveServer('remote');
      expect(useServerStore.getState().activeServerId).toBe('remote');
    });

    it('resets connection status', () => {
      useServerStore.getState().setConnectionStatus('connected');
      useServerStore.getState().setActiveServer('remote');

      expect(useServerStore.getState().connectionStatus).toBe('disconnected');
      expect(useServerStore.getState().connectionError).toBeNull();
    });
  });

  describe('setConnectionStatus', () => {
    it('sets connection status', () => {
      useServerStore.getState().setConnectionStatus('connecting');
      expect(useServerStore.getState().connectionStatus).toBe('connecting');

      useServerStore.getState().setConnectionStatus('connected');
      expect(useServerStore.getState().connectionStatus).toBe('connected');
    });

    it('sets connection error', () => {
      useServerStore.getState().setConnectionStatus('error', 'Connection failed');

      expect(useServerStore.getState().connectionStatus).toBe('error');
      expect(useServerStore.getState().connectionError).toBe('Connection failed');
    });

    it('clears error when status changes', () => {
      useServerStore.getState().setConnectionStatus('error', 'Connection failed');
      useServerStore.getState().setConnectionStatus('connecting');

      expect(useServerStore.getState().connectionError).toBeNull();
    });
  });

  describe('updateLastConnected', () => {
    it('updates last connected timestamp', () => {
      const before = Date.now();
      useServerStore.getState().updateLastConnected('local');
      const after = Date.now();

      const server = useServerStore.getState().servers.find((s) => s.id === 'local');
      expect(server?.lastConnected).toBeGreaterThanOrEqual(before);
      expect(server?.lastConnected).toBeLessThanOrEqual(after);
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
  });

  describe('getDefaultServer', () => {
    it('returns default server', () => {
      const server = useServerStore.getState().getDefaultServer();
      expect(server?.id).toBe('local');
      expect(server?.isDefault).toBe(true);
    });
  });

  describe('setServers', () => {
    it('updates servers list from WebSocket', () => {
      const newServers = [
        {
          id: 'server1',
          name: 'Server 1',
          address: 'host1:3100',
          isDefault: true,
          createdAt: Date.now(),
        },
      ];

      useServerStore.getState().setServers(newServers);
      expect(useServerStore.getState().servers).toEqual(newServers);
    });
  });

  describe('local address override', () => {
    it('reuses the local slot for a manual host:port address', () => {
      useServerStore.getState().setLocalServerAddress('192.168.1.100:3100');

      expect(useServerStore.getState().localServerPort).toBe(3100);
      expect(useServerStore.getState().getActiveServer()?.address).toBe('192.168.1.100:3100');
    });

    it('keeps the override when servers refresh from the backend', () => {
      useServerStore.getState().setLocalServerAddress('192.168.1.100:3100');
      useServerStore.getState().setServers([
        {
          id: 'local',
          name: 'Local Server',
          address: 'localhost:3100',
          isDefault: true,
          createdAt: Date.now(),
        },
      ]);

      expect(useServerStore.getState().servers[0].address).toBe('192.168.1.100:3100');
    });
  });
});
