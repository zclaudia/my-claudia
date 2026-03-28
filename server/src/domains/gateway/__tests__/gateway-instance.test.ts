import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setGatewayClient,
  getGatewayClient,
} from '../gateway-instance.js';

// Mock the types
type MockGatewayClient = { id: string; mock: true };

describe('gateway-instance', () => {
  // Reset module state between tests
  beforeEach(async () => {
    // Clear instances
    setGatewayClient(null);
  });

  afterEach(() => {
    vi.resetModules();
  });

  describe('GatewayClient instance', () => {
    it('returns null when no client is set', () => {
      expect(getGatewayClient()).toBeNull();
    });

    it('sets and gets gateway client', () => {
      const mockClient = { id: 'test-client', mock: true } as unknown as MockGatewayClient;

      setGatewayClient(mockClient as any);
      expect(getGatewayClient()).toBe(mockClient);
    });

    it('can overwrite existing client', () => {
      const firstClient = { id: 'first' } as unknown as MockGatewayClient;
      const secondClient = { id: 'second' } as unknown as MockGatewayClient;

      setGatewayClient(firstClient as any);
      expect(getGatewayClient()).toBe(firstClient);

      setGatewayClient(secondClient as any);
      expect(getGatewayClient()).toBe(secondClient);
    });

    it('can set client to null', () => {
      const mockClient = { id: 'test' } as unknown as MockGatewayClient;

      setGatewayClient(mockClient as any);
      expect(getGatewayClient()).toBe(mockClient);

      setGatewayClient(null);
      expect(getGatewayClient()).toBeNull();
    });
  });
});
