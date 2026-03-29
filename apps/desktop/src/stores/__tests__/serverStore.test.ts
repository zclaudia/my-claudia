import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useServerStore } from '../serverStore';

describe('serverStore', () => {
  beforeEach(() => {
    useServerStore.setState({
      activeServerId: 'local',
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'embedded-local',
      controlPlaneState: 'connecting',
    });
  });

  describe('setActiveServer', () => {
    it('sets active backend id', () => {
      useServerStore.getState().setActiveServer('s1');
      expect(useServerStore.getState().activeServerId).toBe('s1');
    });

    it('is a no-op when setting the same active backend id', () => {
      const previousState = useServerStore.getState();

      useServerStore.getState().setActiveServer('local');

      expect(useServerStore.getState()).toBe(previousState);
    });

    it('sets null active server', () => {
      useServerStore.getState().setActiveServer(null);
      expect(useServerStore.getState().activeServerId).toBeNull();
    });
  });

  describe('setServerConnectionStatus', () => {
    it('sets per-server connection status', () => {
      useServerStore.getState().setServerConnectionStatus('s1', 'connected');
      expect(useServerStore.getState().connections.s1.status).toBe('connected');
    });

    it('stores error on the targeted backend connection', () => {
      useServerStore.getState().setServerConnectionStatus('s1', 'error', 'timeout');
      expect(useServerStore.getState().connections.s1.error).toBe('timeout');
    });
  });

  describe('setServerLocalConnection', () => {
    it('sets per-server local connection', () => {
      useServerStore.getState().setServerLocalConnection('s1', true);
      expect(useServerStore.getState().connections.s1.isLocalConnection).toBe(true);
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
    it('is a no-op compatibility shim', () => {
      useServerStore.getState().updateLastConnected('local');
      expect(useServerStore.getState().activeServerId).toBe('local');
    });
  });

  describe('setLocalServerPort', () => {
    it('updates embedded local server port', () => {
      useServerStore.getState().setLocalServerPort(5555);
      expect(useServerStore.getState().localServerPort).toBe(5555);
    });
  });

  describe('control plane state', () => {
    it('tracks control plane mode', () => {
      useServerStore.getState().setControlPlaneMode('gateway-direct');
      expect(useServerStore.getState().controlPlaneMode).toBe('gateway-direct');
    });

    it('tracks control plane lifecycle state', () => {
      useServerStore.getState().setControlPlaneState('ready');
      expect(useServerStore.getState().controlPlaneState).toBe('ready');
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
