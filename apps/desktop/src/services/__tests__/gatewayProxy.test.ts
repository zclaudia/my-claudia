import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveGatewayBackendUrl, getGatewayAuthHeaders } from '../gatewayProxy.js';

// Mock stores
vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: vi.fn(() => ({ localServerPort: null })),
  },
}));

vi.mock('../../stores/gatewayStore', () => ({
  useGatewayStore: {
    getState: vi.fn(() => ({ gatewayUrl: null, gatewaySecret: null })),
  },
}));

import { useServerStore } from '../../stores/serverStore';
import { useGatewayStore } from '../../stores/gatewayStore';

describe('services/gatewayProxy', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('resolveGatewayBackendUrl', () => {
    it('returns null when no local port and no gateway URL', () => {
      vi.mocked(useServerStore.getState).mockReturnValue({ localServerPort: null } as any);
      vi.mocked(useGatewayStore.getState).mockReturnValue({ gatewayUrl: null } as any);

      const result = resolveGatewayBackendUrl('backend-1');

      expect(result).toBeNull();
    });

    it('routes through local proxy on desktop', () => {
      vi.mocked(useServerStore.getState).mockReturnValue({ localServerPort: 3456 } as any);

      const result = resolveGatewayBackendUrl('my-backend');

      expect(result).toBe('http://127.0.0.1:3456/api/gateway-proxy/my-backend');
    });

    it('routes directly to gateway on mobile (with ws://)', () => {
      vi.mocked(useServerStore.getState).mockReturnValue({ localServerPort: null } as any);
      vi.mocked(useGatewayStore.getState).mockReturnValue({ gatewayUrl: 'ws://gateway.example.com' } as any);

      const result = resolveGatewayBackendUrl('backend-1');

      expect(result).toBe('http://gateway.example.com/api/proxy/backend-1');
    });

    it('routes directly to gateway on mobile (with wss://)', () => {
      vi.mocked(useServerStore.getState).mockReturnValue({ localServerPort: null } as any);
      vi.mocked(useGatewayStore.getState).mockReturnValue({ gatewayUrl: 'wss://secure.gateway.com' } as any);

      const result = resolveGatewayBackendUrl('backend-1');

      expect(result).toBe('https://secure.gateway.com/api/proxy/backend-1');
    });

    it('routes directly to gateway on mobile (without protocol)', () => {
      vi.mocked(useServerStore.getState).mockReturnValue({ localServerPort: null } as any);
      vi.mocked(useGatewayStore.getState).mockReturnValue({ gatewayUrl: 'gateway.example.com:8080' } as any);

      const result = resolveGatewayBackendUrl('backend-1');

      expect(result).toBe('http://gateway.example.com:8080/api/proxy/backend-1');
    });

    it('prioritizes desktop local proxy over gateway URL', () => {
      vi.mocked(useServerStore.getState).mockReturnValue({ localServerPort: 3456 } as any);
      vi.mocked(useGatewayStore.getState).mockReturnValue({ gatewayUrl: 'ws://gateway.example.com' } as any);

      const result = resolveGatewayBackendUrl('backend-1');

      expect(result).toBe('http://127.0.0.1:3456/api/gateway-proxy/backend-1');
    });
  });

  describe('getGatewayAuthHeaders', () => {
    it('returns empty on desktop (local proxy handles auth)', () => {
      vi.mocked(useServerStore.getState).mockReturnValue({ localServerPort: 3456 } as any);
      vi.mocked(useGatewayStore.getState).mockReturnValue({ gatewaySecret: 'secret123' } as any);

      const result = getGatewayAuthHeaders();

      expect(result).toEqual({});
    });

    it('returns empty on mobile without gateway secret', () => {
      vi.mocked(useServerStore.getState).mockReturnValue({ localServerPort: null } as any);
      vi.mocked(useGatewayStore.getState).mockReturnValue({ gatewaySecret: null } as any);

      const result = getGatewayAuthHeaders();

      expect(result).toEqual({});
    });

    it('returns Bearer token on mobile with gateway secret', () => {
      vi.mocked(useServerStore.getState).mockReturnValue({ localServerPort: null } as any);
      vi.mocked(useGatewayStore.getState).mockReturnValue({ gatewaySecret: 'my-secret-token' } as any);

      const result = getGatewayAuthHeaders();

      expect(result).toEqual({ Authorization: 'Bearer my-secret-token' });
    });
  });
});
