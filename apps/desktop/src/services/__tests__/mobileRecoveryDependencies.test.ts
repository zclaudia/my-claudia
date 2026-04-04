import { beforeEach, describe, expect, it } from 'vitest';
import { getMobileRecoveryOwnerBackendId } from '../mobileRecoveryDependencies';
import { useOwnershipStore } from '../../stores/ownershipStore';

describe('mobileRecoveryDependencies', () => {
  beforeEach(() => {
    useOwnershipStore.setState({
      sessionBackendIds: {},
      sessionOwnershipVersions: {},
      projectBackendIds: {},
      taskOwners: {},
    } as any);
  });

  it('uses ownership store for the session backend when present', () => {
    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'owner-backend' },
    } as any);

    expect(getMobileRecoveryOwnerBackendId('session-1', 'fallback-backend')).toBe('owner-backend');
  });

  it('falls back to the provided backend id when ownership is missing', () => {
    expect(getMobileRecoveryOwnerBackendId('missing-session', 'fallback-backend')).toBe('fallback-backend');
  });
});
