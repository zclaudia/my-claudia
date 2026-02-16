import { describe, it, expect } from 'vitest';
import { providerRegistry } from '../registry.js';
import type { ProviderAdapter } from '../types.js';

/** Minimal fake adapter used for testing register/get */
function createFakeAdapter(type: string): ProviderAdapter {
  return {
    type,
    async *run() {
      // no-op generator
    },
  };
}

describe('ProviderRegistry', () => {
  describe('built-in adapters', () => {
    it('has a claude adapter registered by default', () => {
      const adapter = providerRegistry.get('claude');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('claude');
    });

    it('has an opencode adapter registered by default', () => {
      const adapter = providerRegistry.get('opencode');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('opencode');
    });
  });

  describe('register', () => {
    it('adds a new adapter that can be retrieved', () => {
      const fake = createFakeAdapter('custom-provider');
      providerRegistry.register(fake);

      const retrieved = providerRegistry.get('custom-provider');
      expect(retrieved).toBeDefined();
      expect(retrieved).toBe(fake);
      expect(retrieved!.type).toBe('custom-provider');
    });

    it('overwrites an existing adapter with the same type', () => {
      const fake1 = createFakeAdapter('overwrite-test');
      const fake2 = createFakeAdapter('overwrite-test');

      providerRegistry.register(fake1);
      providerRegistry.register(fake2);

      const retrieved = providerRegistry.get('overwrite-test');
      expect(retrieved).toBe(fake2);
    });
  });

  describe('get', () => {
    it('returns the registered adapter for a known type', () => {
      const adapter = providerRegistry.get('claude');
      expect(adapter).toBeDefined();
      expect(adapter!.type).toBe('claude');
    });

    it('returns undefined for an unknown type', () => {
      const adapter = providerRegistry.get('nonexistent-provider-xyz');
      expect(adapter).toBeUndefined();
    });
  });

  describe('getOrDefault', () => {
    it('returns the requested adapter when it exists', () => {
      const adapter = providerRegistry.getOrDefault('opencode');
      expect(adapter).toBeDefined();
      expect(adapter.type).toBe('opencode');
    });

    it('falls back to the claude adapter for an unknown type', () => {
      const adapter = providerRegistry.getOrDefault('unknown-type-abc');
      expect(adapter).toBeDefined();
      expect(adapter.type).toBe('claude');
    });

    it('always returns a defined adapter (never undefined)', () => {
      const adapter = providerRegistry.getOrDefault('does-not-exist');
      expect(adapter).toBeDefined();
    });
  });
});
