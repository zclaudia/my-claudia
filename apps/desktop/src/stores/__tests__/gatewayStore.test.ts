import { beforeEach, describe, expect, it } from 'vitest';
import { useGatewayStore, shouldShowBackend } from '../gatewayStore';
import { useFacadeStore } from '../facadeStore';
import type { GatewayBackendInfo } from '@my-claudia/shared';

describe('gatewayStore', () => {
  beforeEach(() => {
    useGatewayStore.setState({
      gatewayUrl: null,
      gatewaySecret: null,
      isConnected: false,
      backendAuthStatus: {},
      directGatewayUrl: null,
      directGatewaySecret: null,
      lastActiveBackendId: null,
      subscribedBackendIds: [],
      showLocalBackend: false,
    });

    useFacadeStore.setState({
      facade: null,
      mode: null,
      connectionState: 'idle',
      backends: [],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      snapshotVersion: 0,
    });
  });

  const createBackend = (overrides: Partial<GatewayBackendInfo> = {}): GatewayBackendInfo => ({
    backendId: 'backend-1',
    name: 'Test Backend',
    online: true,
    ...overrides,
  });

  it('sets connected to true', () => {
    useGatewayStore.getState().setConnected(true);
    expect(useGatewayStore.getState().isConnected).toBe(true);
  });

  it('clears backend auth status on disconnect', () => {
    useGatewayStore.getState().setConnected(true);
    useGatewayStore.getState().setBackendAuthStatus('backend-1', 'authenticated');
    useGatewayStore.getState().setConnected(false);
    expect(useGatewayStore.getState().backendAuthStatus).toEqual({});
  });

  it('sets backend auth status', () => {
    useGatewayStore.getState().setBackendAuthStatus('backend-1', 'pending');
    expect(useGatewayStore.getState().backendAuthStatus['backend-1']).toBe('pending');
  });

  it('clears gateway runtime state', () => {
    useGatewayStore.setState({
      gatewayUrl: 'https://gw.example.com',
      gatewaySecret: 'secret',
      isConnected: true,
      backendAuthStatus: { 'backend-1': 'authenticated' },
    });

    useGatewayStore.getState().clearGateway();

    const state = useGatewayStore.getState();
    expect(state.gatewayUrl).toBeNull();
    expect(state.gatewaySecret).toBeNull();
    expect(state.isConnected).toBe(false);
    expect(state.backendAuthStatus).toEqual({});
  });

  it('sets direct gateway config and seeds runtime gateway fields', () => {
    useGatewayStore.getState().setDirectGatewayConfig('https://gw', 'secret');

    const state = useGatewayStore.getState();
    expect(state.directGatewayUrl).toBe('https://gw');
    expect(state.directGatewaySecret).toBe('secret');
    expect(state.gatewayUrl).toBe('https://gw');
    expect(state.gatewaySecret).toBe('secret');
  });

  it('clears direct gateway config', () => {
    useGatewayStore.setState({
      directGatewayUrl: 'url',
      directGatewaySecret: 'sec',
      lastActiveBackendId: 'backend-1',
      gatewayUrl: 'url',
      gatewaySecret: 'sec',
      isConnected: true,
      backendAuthStatus: { 'backend-1': 'authenticated' },
    });

    useGatewayStore.getState().clearDirectGatewayConfig();

    const state = useGatewayStore.getState();
    expect(state.directGatewayUrl).toBeNull();
    expect(state.directGatewaySecret).toBeNull();
    expect(state.lastActiveBackendId).toBeNull();
    expect(state.gatewayUrl).toBeNull();
    expect(state.gatewaySecret).toBeNull();
    expect(state.isConnected).toBe(false);
    expect(state.backendAuthStatus).toEqual({});
  });

  it('returns true for hasDirectConfig only when both fields exist', () => {
    expect(useGatewayStore.getState().hasDirectConfig()).toBe(false);
    useGatewayStore.setState({ directGatewayUrl: 'url', directGatewaySecret: 'sec' });
    expect(useGatewayStore.getState().hasDirectConfig()).toBe(true);
  });

  it('returns true for isConfigured only when both runtime fields exist', () => {
    expect(useGatewayStore.getState().isConfigured()).toBe(false);
    useGatewayStore.setState({ gatewayUrl: 'url', gatewaySecret: 'sec' });
    expect(useGatewayStore.getState().isConfigured()).toBe(true);
  });

  it('toggles showLocalBackend', () => {
    useGatewayStore.getState().setShowLocalBackend(true);
    expect(useGatewayStore.getState().showLocalBackend).toBe(true);
  });

  describe('shouldShowBackend', () => {
    it('shows backend when currentInstanceId is unknown', () => {
      const backend = createBackend({ isThisInstance: true });
      expect(shouldShowBackend(backend, null, false)).toBe(true);
    });

    it('hides this-instance backend when currentInstanceId is known', () => {
      const backend = createBackend({ isThisInstance: true, instanceId: 'inst-1' });
      expect(shouldShowBackend(backend, 'inst-1', false)).toBe(false);
    });

    it('shows this-instance backend when debug toggle is enabled', () => {
      const backend = createBackend({ isThisInstance: true, instanceId: 'inst-1' });
      expect(shouldShowBackend(backend, 'inst-1', true)).toBe(true);
    });
  });
});
