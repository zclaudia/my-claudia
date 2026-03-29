import { describe, expect, it } from 'vitest';
import { shouldShowDirectGatewaySetup } from '../directGatewaySetup';

describe('shouldShowDirectGatewaySetup', () => {
  it('returns true without gateway config', () => {
    expect(shouldShowDirectGatewaySetup({
      directGatewayUrl: null,
      activeServerId: null,
      availableBackendIds: [],
    })).toBe(true);
  });

  it('returns true without a selected backend', () => {
    expect(shouldShowDirectGatewaySetup({
      directGatewayUrl: 'https://gateway.example.com',
      activeServerId: null,
      availableBackendIds: ['backend-1'],
    })).toBe(true);
  });

  it('returns true when the selected backend is missing', () => {
    expect(shouldShowDirectGatewaySetup({
      directGatewayUrl: 'https://gateway.example.com',
      activeServerId: 'backend-missing',
      availableBackendIds: ['backend-1'],
    })).toBe(true);
  });

  it('returns false when the selected backend is available', () => {
    expect(shouldShowDirectGatewaySetup({
      directGatewayUrl: 'https://gateway.example.com',
      activeServerId: 'backend-1',
      availableBackendIds: ['backend-1', 'backend-2'],
    })).toBe(false);
  });
});
