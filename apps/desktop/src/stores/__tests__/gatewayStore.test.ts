import { describe, it, expect, beforeEach } from 'vitest';
import {
  useGatewayStore,
  toGatewayServerId,
  isGatewayTarget,
  parseBackendId,
  shouldShowBackend,
} from '../gatewayStore';
import type { GatewayBackendInfo } from '@my-claudia/shared';

describe('gatewayStore', () => {
  beforeEach(() => {
    useGatewayStore.setState({
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
      localBackendId: null,
      discoveredBackends: [],
      backendAuthStatus: {},
      directGatewayUrl: null,
      directGatewaySecret: null,
      lastActiveBackendId: null,
      subscribedBackendIds: [],
      showLocalBackend: false,
    });
  });

  const createBackend = (overrides: Partial<GatewayBackendInfo> = {}): GatewayBackendInfo => ({
    backendId: 'backend-1',
    name: 'Test Backend',
    online: true,
    ...overrides,
  });

  describe('syncFromServer', () => {
    it('sets gateway url, secret, and backends', () => {
      const backends = [createBackend()];
      useGatewayStore.getState().syncFromServer('https://gw.example.com', 'secret-123', backends);

      const state = useGatewayStore.getState();
      expect(state.gatewayUrl).toBe('https://gw.example.com');
      expect(state.gatewaySecret).toBe('secret-123');
      expect(state.discoveredBackends).toEqual(backends);
    });

    it('can set url and secret to null', () => {
      useGatewayStore.getState().syncFromServer('https://gw.example.com', 'secret-123', []);
      useGatewayStore.getState().syncFromServer(null, null, []);

      const state = useGatewayStore.getState();
      expect(state.gatewayUrl).toBeNull();
      expect(state.gatewaySecret).toBeNull();
    });

    it('sets localBackendId when provided', () => {
      useGatewayStore.getState().syncFromServer('url', 'sec', [], 'local-id');
      expect(useGatewayStore.getState().localBackendId).toBe('local-id');
    });

    it('marks isLocal on backends', () => {
      const backends = [
        createBackend({ backendId: 'b1' }),
        createBackend({ backendId: 'local-id' }),
      ];
      useGatewayStore.getState().syncFromServer('url', 'sec', backends, 'local-id');
      const bk = useGatewayStore.getState().discoveredBackends;
      expect(bk[0].isLocal).toBeFalsy();
      expect(bk[1].isLocal).toBe(true);
    });

    it('sets connected flag when provided', () => {
      useGatewayStore.getState().syncFromServer('url', 'sec', [], null, true);
      expect(useGatewayStore.getState().isConnected).toBe(true);
    });

    it('preserves existing localBackendId when not provided', () => {
      useGatewayStore.setState({ localBackendId: 'existing' });
      useGatewayStore.getState().syncFromServer('url', 'sec', []);
      expect(useGatewayStore.getState().localBackendId).toBe('existing');
    });
  });

  describe('setConnected', () => {
    it('sets connected to true', () => {
      useGatewayStore.getState().setConnected(true);
      expect(useGatewayStore.getState().isConnected).toBe(true);
    });

    it('clears runtime state on disconnect', () => {
      const backends = [createBackend()];
      useGatewayStore.getState().syncFromServer('https://gw.example.com', 'secret', backends);
      useGatewayStore.getState().setBackendAuthStatus('backend-1', 'authenticated');
      useGatewayStore.getState().setConnected(true);

      useGatewayStore.getState().setConnected(false);

      const state = useGatewayStore.getState();
      expect(state.isConnected).toBe(false);
      // discoveredBackends are managed by syncFromServer polling, not cleared on disconnect
      expect(state.discoveredBackends).toHaveLength(1);
      expect(state.backendAuthStatus).toEqual({});
    });
  });

  describe('setDiscoveredBackends', () => {
    it('sets discovered backends', () => {
      const backends = [
        createBackend({ backendId: 'b1' }),
        createBackend({ backendId: 'b2', online: false }),
      ];
      useGatewayStore.getState().setDiscoveredBackends(backends);

      expect(useGatewayStore.getState().discoveredBackends).toEqual(backends);
    });

    it('replaces existing backends', () => {
      useGatewayStore.getState().setDiscoveredBackends([createBackend({ backendId: 'b1' })]);
      useGatewayStore.getState().setDiscoveredBackends([createBackend({ backendId: 'b2' })]);

      const backends = useGatewayStore.getState().discoveredBackends;
      expect(backends).toHaveLength(1);
      expect(backends[0].backendId).toBe('b2');
    });
  });

  describe('setBackendAuthStatus', () => {
    it('sets auth status for a backend', () => {
      useGatewayStore.getState().setBackendAuthStatus('backend-1', 'authenticated');
      expect(useGatewayStore.getState().backendAuthStatus['backend-1']).toBe('authenticated');
    });

    it('sets different statuses for different backends', () => {
      useGatewayStore.getState().setBackendAuthStatus('b1', 'authenticated');
      useGatewayStore.getState().setBackendAuthStatus('b2', 'pending');
      useGatewayStore.getState().setBackendAuthStatus('b3', 'failed');

      const status = useGatewayStore.getState().backendAuthStatus;
      expect(status['b1']).toBe('authenticated');
      expect(status['b2']).toBe('pending');
      expect(status['b3']).toBe('failed');
    });

    it('updates existing status', () => {
      useGatewayStore.getState().setBackendAuthStatus('b1', 'pending');
      useGatewayStore.getState().setBackendAuthStatus('b1', 'authenticated');

      expect(useGatewayStore.getState().backendAuthStatus['b1']).toBe('authenticated');
    });
  });

  describe('clearGateway', () => {
    it('resets all gateway state', () => {
      useGatewayStore.getState().syncFromServer('https://gw.example.com', 'secret', [createBackend()]);
      useGatewayStore.getState().setConnected(true);
      useGatewayStore.getState().setBackendAuthStatus('backend-1', 'authenticated');

      useGatewayStore.getState().clearGateway();

      const state = useGatewayStore.getState();
      expect(state.gatewayUrl).toBeNull();
      expect(state.gatewaySecret).toBeNull();
      expect(state.isConnected).toBe(false);
      expect(state.discoveredBackends).toEqual([]);
      expect(state.backendAuthStatus).toEqual({});
    });
  });

  describe('setDirectGatewayConfig', () => {
    it('sets direct config and runtime state', () => {
      useGatewayStore.getState().setDirectGatewayConfig('https://gw', 'secret');
      const s = useGatewayStore.getState();
      expect(s.directGatewayUrl).toBe('https://gw');
      expect(s.directGatewaySecret).toBe('secret');
      expect(s.gatewayUrl).toBe('https://gw');
      expect(s.gatewaySecret).toBe('secret');
    });
  });

  describe('setLastActiveBackend', () => {
    it('sets last active backend', () => {
      useGatewayStore.getState().setLastActiveBackend('gw:b1');
      expect(useGatewayStore.getState().lastActiveBackendId).toBe('gw:b1');
    });
  });

  describe('clearDirectGatewayConfig', () => {
    it('clears all direct gateway config and runtime state', () => {
      useGatewayStore.setState({
        directGatewayUrl: 'url', directGatewaySecret: 'sec',
        lastActiveBackendId: 'gw:b1', gatewayUrl: 'url', gatewaySecret: 'sec',
        isConnected: true, discoveredBackends: [createBackend()],
      });
      useGatewayStore.getState().clearDirectGatewayConfig();
      const s = useGatewayStore.getState();
      expect(s.directGatewayUrl).toBeNull();
      expect(s.directGatewaySecret).toBeNull();
      expect(s.lastActiveBackendId).toBeNull();
      expect(s.gatewayUrl).toBeNull();
      expect(s.isConnected).toBe(false);
      expect(s.discoveredBackends).toHaveLength(0);
    });
  });

  describe('toggleBackendSubscription', () => {
    it('switches from all-subscribed to explicit list excluding target', () => {
      useGatewayStore.setState({
        discoveredBackends: [createBackend({ backendId: 'b1' }), createBackend({ backendId: 'b2' })],
        subscribedBackendIds: [],
      });
      useGatewayStore.getState().toggleBackendSubscription('b1');
      expect(useGatewayStore.getState().subscribedBackendIds).toEqual(['b2']);
    });

    it('unsubscribes when already in list', () => {
      useGatewayStore.setState({ subscribedBackendIds: ['b1', 'b2'] });
      useGatewayStore.getState().toggleBackendSubscription('b1');
      expect(useGatewayStore.getState().subscribedBackendIds).toEqual(['b2']);
    });

    it('subscribes when not in list', () => {
      useGatewayStore.setState({ subscribedBackendIds: ['b1'] });
      useGatewayStore.getState().toggleBackendSubscription('b2');
      expect(useGatewayStore.getState().subscribedBackendIds).toEqual(['b1', 'b2']);
    });
  });

  describe('isBackendSubscribed', () => {
    it('returns true when empty (all subscribed)', () => {
      expect(useGatewayStore.getState().isBackendSubscribed('any')).toBe(true);
    });

    it('returns true when in list', () => {
      useGatewayStore.setState({ subscribedBackendIds: ['b1'] });
      expect(useGatewayStore.getState().isBackendSubscribed('b1')).toBe(true);
    });

    it('returns false when not in list', () => {
      useGatewayStore.setState({ subscribedBackendIds: ['b1'] });
      expect(useGatewayStore.getState().isBackendSubscribed('b2')).toBe(false);
    });
  });

  describe('hasDirectConfig', () => {
    it('returns false when no direct config', () => {
      expect(useGatewayStore.getState().hasDirectConfig()).toBe(false);
    });

    it('returns true when direct config set', () => {
      useGatewayStore.setState({ directGatewayUrl: 'url', directGatewaySecret: 'sec' });
      expect(useGatewayStore.getState().hasDirectConfig()).toBe(true);
    });
  });

  describe('setShowLocalBackend', () => {
    it('toggles show local backend', () => {
      useGatewayStore.getState().setShowLocalBackend(true);
      expect(useGatewayStore.getState().showLocalBackend).toBe(true);
    });
  });

  describe('setDiscoveredBackends with localBackendId', () => {
    it('marks isLocal based on stored localBackendId', () => {
      useGatewayStore.setState({ localBackendId: 'b1' });
      useGatewayStore.getState().setDiscoveredBackends([
        createBackend({ backendId: 'b1' }),
        createBackend({ backendId: 'b2' }),
      ]);
      const bk = useGatewayStore.getState().discoveredBackends;
      expect(bk[0].isLocal).toBe(true);
      expect(bk[1].isLocal).toBeFalsy();
    });
  });

  describe('isConfigured', () => {
    it('returns false when url and secret are null', () => {
      expect(useGatewayStore.getState().isConfigured()).toBe(false);
    });

    it('returns false when only url is set', () => {
      useGatewayStore.setState({ gatewayUrl: 'https://gw.example.com' });
      expect(useGatewayStore.getState().isConfigured()).toBe(false);
    });

    it('returns false when only secret is set', () => {
      useGatewayStore.setState({ gatewaySecret: 'secret' });
      expect(useGatewayStore.getState().isConfigured()).toBe(false);
    });

    it('returns true when both url and secret are set', () => {
      useGatewayStore.getState().syncFromServer('https://gw.example.com', 'secret', []);
      expect(useGatewayStore.getState().isConfigured()).toBe(true);
    });
  });

  describe('utility functions', () => {
    describe('shouldShowBackend', () => {
      it('shows local-marked backend when localBackendId is unknown', () => {
        const backend = createBackend({ isLocal: true });
        expect(shouldShowBackend(backend, null, false)).toBe(true);
      });

      it('hides local-marked backend when localBackendId exists', () => {
        const backend = createBackend({ isLocal: true });
        expect(shouldShowBackend(backend, 'backend-1', false)).toBe(false);
      });

      it('shows local backend when debug toggle is enabled', () => {
        const backend = createBackend({ isLocal: true });
        expect(shouldShowBackend(backend, 'backend-1', true)).toBe(true);
      });
    });

    describe('toGatewayServerId', () => {
      it('prefixes backendId with gw:', () => {
        expect(toGatewayServerId('backend-1')).toBe('gw:backend-1');
      });

      it('works with empty string', () => {
        expect(toGatewayServerId('')).toBe('gw:');
      });
    });

    describe('isGatewayTarget', () => {
      it('returns true for gw: prefixed strings', () => {
        expect(isGatewayTarget('gw:backend-1')).toBe(true);
      });

      it('returns false for non-gw strings', () => {
        expect(isGatewayTarget('backend-1')).toBe(false);
      });

      it('returns false for null', () => {
        expect(isGatewayTarget(null)).toBe(false);
      });

      it('returns false for empty string', () => {
        expect(isGatewayTarget('')).toBe(false);
      });

      it('returns true for gw: with empty suffix', () => {
        expect(isGatewayTarget('gw:')).toBe(true);
      });
    });

    describe('parseBackendId', () => {
      it('extracts backendId from gw: prefixed serverId', () => {
        expect(parseBackendId('gw:backend-1')).toBe('backend-1');
      });

      it('handles complex backend ids', () => {
        expect(parseBackendId('gw:my-backend:with:colons')).toBe('my-backend:with:colons');
      });

      it('returns empty string for gw: prefix only', () => {
        expect(parseBackendId('gw:')).toBe('');
      });
    });
  });

  describe('persist migration', () => {
    it('migrates from version 0 (removes old fields, adds subscribedBackendIds)', () => {
      const persistApi = (useGatewayStore as any).persist;
      const options = persistApi?.getOptions?.();
      if (options?.migrate) {
        const result = options.migrate({ gatewayUrl: 'old', gatewaySecret: 'old', backendApiKeys: {} }, 0);
        expect(result.gatewayUrl).toBeUndefined();
        expect(result.gatewaySecret).toBeUndefined();
        expect(result.backendApiKeys).toBeUndefined();
        expect(result.subscribedBackendIds).toEqual([]);
      }
    });

    it('migrates from version 4 (adds subscribedBackendIds only)', () => {
      const persistApi = (useGatewayStore as any).persist;
      const options = persistApi?.getOptions?.();
      if (options?.migrate) {
        const result = options.migrate({ directGatewayUrl: 'url' }, 4);
        expect(result.directGatewayUrl).toBe('url');
        expect(result.subscribedBackendIds).toEqual([]);
      }
    });

    it('does not modify version 5 data', () => {
      const persistApi = (useGatewayStore as any).persist;
      const options = persistApi?.getOptions?.();
      if (options?.migrate) {
        const result = options.migrate({ subscribedBackendIds: ['b1'] }, 5);
        expect(result.subscribedBackendIds).toEqual(['b1']);
      }
    });
  });
});
