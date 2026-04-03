import { beforeEach, describe, expect, it } from 'vitest';
import { useServerStore } from './serverStore';

describe('serverStore', () => {
  beforeEach(() => {
    useServerStore.setState({
      activeServerId: null,
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'embedded-local',
    });
  });

  it('sets active server id', () => {
    useServerStore.getState().setActiveServer('backend-1');
    expect(useServerStore.getState().activeServerId).toBe('backend-1');
  });

  it('stores local connection metadata per backend', () => {
    useServerStore.getState().setServerLocalConnection('backend-1', true);
    expect(useServerStore.getState().connections['backend-1']?.isLocalConnection).toBe(true);
  });

  it('stores backend features', () => {
    useServerStore.getState().setServerFeatures('backend-1', ['search', 'fileUpload']);
    expect(useServerStore.getState().connections['backend-1']?.features).toEqual(['search', 'fileUpload']);
  });

  it('stores backend public key', () => {
    useServerStore.getState().setServerPublicKey('backend-1', 'pem-key');
    expect(useServerStore.getState().connections['backend-1']?.publicKey).toBe('pem-key');
  });

  it('stores backend latency', () => {
    useServerStore.getState().setServerLatency('backend-1', 123);
    expect(useServerStore.getState().connections['backend-1']?.latencyMs).toBe(123);
    expect(useServerStore.getState().connections['backend-1']?.lastLatencyProbeAt).toBeTypeOf('number');
  });

  it('updates control plane mode', () => {
    useServerStore.getState().setControlPlaneMode('gateway-direct');
    expect(useServerStore.getState().controlPlaneMode).toBe('gateway-direct');
  });

  it('returns active server connection', () => {
    useServerStore.getState().setServerFeatures('backend-1', ['search']);
    useServerStore.getState().setActiveServer('backend-1');
    expect(useServerStore.getState().getActiveServerConnection()?.features).toEqual(['search']);
  });

  it('checks active server feature support', () => {
    useServerStore.getState().setServerFeatures('backend-1', ['search']);
    useServerStore.getState().setActiveServer('backend-1');

    expect(useServerStore.getState().activeServerSupports('search')).toBe(true);
    expect(useServerStore.getState().activeServerSupports('fileUpload')).toBe(false);
  });
});
