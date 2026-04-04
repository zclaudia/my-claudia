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
  it('derives mobile control-plane state from facade connection and recovery phase', () => {
    expect(getMobileControlPlaneState('connected', 'ready')).toBe('ready');
    expect(getMobileControlPlaneState('connected', 'recovering')).toBe('connecting');
    expect(getMobileControlPlaneState('error', 'idle')).toBe('error');
  });

  it('derives mobile backend view state without the legacy recovery type dependency', () => {
    expect(getMobileBackendViewState('backend-1', 'connected', [readyBackend], 'ready')).toBe('ready');
    expect(getMobileBackendViewState('backend-1', 'connected', [readyBackend], 'recovering')).toBe('backend_subscribing');
    expect(getMobileBackendViewState('missing', 'connected', [readyBackend], 'ready')).toBe('offline');
  });

  it('treats recovery and error phases as unavailable for gateway/backend usage', () => {
    expect(isMobileGatewayConnected('connected', 'ready')).toBe(true);
    expect(isMobileGatewayConnected('connected', 'recovering')).toBe(false);
    expect(getUsableMobileBackendIds('connected', [readyBackend], 'ready')).toEqual(['backend-1']);
    expect(getUsableMobileBackendIds('connected', [readyBackend], 'error')).toEqual([]);
  });
});
