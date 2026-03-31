import { describe, expect, it } from 'vitest';
import { canReachBackend, getEffectiveBackendStatus, isBackendReady } from '../backendConnection';

const backend = {
  online: true,
  runtimeState: 'ready',
  openState: 'open',
} as const;

describe('backendConnection', () => {
  it('treats transport-connected ready backend as reachable and ready', () => {
    expect(canReachBackend('connected', backend as any)).toBe(true);
    expect(isBackendReady('connected', backend as any)).toBe(true);
    expect(getEffectiveBackendStatus('connected', backend as any)).toBe('connected');
  });

  it('does not treat stale online backend as reachable while transport reconnects', () => {
    expect(canReachBackend('reconnecting', backend as any)).toBe(false);
    expect(isBackendReady('reconnecting', backend as any)).toBe(false);
    expect(getEffectiveBackendStatus('reconnecting', backend as any)).toBe('connecting');
  });

  it('maps disconnected transport to disconnected backend status even if backend is online', () => {
    expect(getEffectiveBackendStatus('disconnected', backend as any)).toBe('disconnected');
  });

  it('maps backend runtime opening to connecting', () => {
    expect(getEffectiveBackendStatus('connected', {
      online: true,
      runtimeState: 'opening',
      openState: 'opening',
    } as any)).toBe('connecting');
  });

  it('maps backend runtime error to error', () => {
    expect(getEffectiveBackendStatus('connected', {
      online: true,
      runtimeState: 'error',
      openState: 'error',
    } as any)).toBe('error');
  });
});
