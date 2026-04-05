import { describe, expect, it } from 'vitest';
import {
  getMobileBackendViewState,
  getMobileControlPlaneState,
  getUsableMobileBackendIds,
  isMobileGatewayConnected,
} from '../mobileConnectionState';

const readyBackend = {
  backendId: 'backend-1',
  runtimeState: 'ready',
  openState: 'open',
  online: true,
  name: 'Backend 1',
} as any;

describe('mobileConnectionState', () => {
  it('does not mark control plane ready until facade snapshots have progressed', () => {
    expect(getMobileControlPlaneState('connected', 0)).toBe('connecting');
    expect(getMobileControlPlaneState('connected', 1)).toBe('connecting');
    expect(getMobileControlPlaneState('connected', 2)).toBe('ready');
    expect(getMobileControlPlaneState('error', 2)).toBe('error');
  });

  it('derives backend view state from transport and backend runtime state', () => {
    expect(getMobileBackendViewState('backend-1', 'connected', [readyBackend])).toBe('ready');
    expect(getMobileBackendViewState('backend-1', 'reconnecting', [readyBackend])).toBe('transport_reconnecting');
    expect(getMobileBackendViewState('missing', 'connected', [readyBackend])).toBe('offline');
  });

  it('treats only ready backends as usable', () => {
    expect(isMobileGatewayConnected('connected')).toBe(true);
    expect(getUsableMobileBackendIds('connected', [readyBackend])).toEqual(['backend-1']);
    expect(getUsableMobileBackendIds('reconnecting', [readyBackend])).toEqual([]);
  });
});
