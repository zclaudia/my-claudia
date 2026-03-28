import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  setGatewayClient,
  getGatewayClient,
  setGatewayClientMode,
  getGatewayClientMode,
} from '../gateway-instance.js';

// Mock the types
type MockGatewayClient = { id: string; mock: true };
type MockGatewayClientMode = { id: string; mode: true };

describe('gateway-instance', () => {
  // Reset module state between tests
  beforeEach(async () => {
    // Clear instances
    setGatewayClient(null);
    setGatewayClientMode(null);
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

  describe('GatewayClientMode instance', () => {
    it('returns null when no client mode is set', () => {
      expect(getGatewayClientMode()).toBeNull();
    });

    it('sets and gets gateway client mode', () => {
      const mockMode = { id: 'test-mode', mode: true } as unknown as MockGatewayClientMode;

      setGatewayClientMode(mockMode as any);
      expect(getGatewayClientMode()).toBe(mockMode);
    });

    it('can overwrite existing client mode', () => {
      const firstMode = { id: 'first' } as unknown as MockGatewayClientMode;
      const secondMode = { id: 'second' } as unknown as MockGatewayClientMode;

      setGatewayClientMode(firstMode as any);
      expect(getGatewayClientMode()).toBe(firstMode);

      setGatewayClientMode(secondMode as any);
      expect(getGatewayClientMode()).toBe(secondMode);
    });

    it('can set client mode to null', () => {
      const mockMode = { id: 'test' } as unknown as MockGatewayClientMode;

      setGatewayClientMode(mockMode as any);
      expect(getGatewayClientMode()).toBe(mockMode);

      setGatewayClientMode(null);
      expect(getGatewayClientMode()).toBeNull();
    });
  });

  describe('independence', () => {
    it('client and clientMode are stored separately', () => {
      const mockClient = { id: 'client' } as unknown as MockGatewayClient;
      const mockMode = { id: 'mode' } as unknown as MockGatewayClientMode;

      setGatewayClient(mockClient as any);
      setGatewayClientMode(mockMode as any);

      expect(getGatewayClient()).toBe(mockClient);
      expect(getGatewayClientMode()).toBe(mockMode);
    });

    it('setting one does not affect the other', () => {
      const mockClient = { id: 'client' } as unknown as MockGatewayClient;
      const mockMode = { id: 'mode' } as unknown as MockGatewayClientMode;

      setGatewayClient(mockClient as any);
      setGatewayClientMode(mockMode as any);

      setGatewayClient(null);

      expect(getGatewayClient()).toBeNull();
      expect(getGatewayClientMode()).toBe(mockMode);
    });
  });
});
