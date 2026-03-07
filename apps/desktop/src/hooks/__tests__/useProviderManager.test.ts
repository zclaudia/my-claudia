import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useProviderManager } from '../useProviderManager.js';

// Mock the api module
vi.mock('../../services/api', () => ({
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
}));

describe('hooks/useProviderManager', () => {
  let mockCreateProvider: ReturnType<typeof vi.fn>;
  let mockUpdateProvider: ReturnType<typeof vi.fn>;
  let mockDeleteProvider: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

    const api = vi.importMock('../../services/api') as {
      createProvider: ReturnType<typeof vi.fn>;
      updateProvider: ReturnType<typeof vi.fn>;
      deleteProvider: ReturnType<typeof vi.fn>;
    };

    mockCreateProvider = api.createProvider;
    mockUpdateProvider = api.updateProvider;
    mockDeleteProvider = api.deleteProvider;
  });

  describe('return value', () => {
    it('returns all manager functions', () => {
      const { result } = renderHook(() => useProviderManager());

      expect(result.current).toHaveProperty('addProvider');
      expect(result.current).toHaveProperty('updateProvider');
      expect(result.current).toHaveProperty('deleteProvider');

      expect(typeof result.current.addProvider).toBe('function');
      expect(typeof result.current.updateProvider).toBe('function');
      expect(typeof result.current.deleteProvider).toBe('function');
    });

    it('returns stable function references', () => {
      const { result, rerender } = renderHook(() => useProviderManager());

      const firstAddProvider = result.current.addProvider;
      const firstUpdateProvider = result.current.updateProvider;
      const firstDeleteProvider = result.current.deleteProvider;

      rerender();

      expect(result.current.addProvider).toBe(firstAddProvider);
      expect(result.current.updateProvider).toBe(firstUpdateProvider);
      expect(result.current.deleteProvider).toBe(firstDeleteProvider);
    });
  });

  describe('addProvider', () => {
    it('calls createProvider API with provider data', async () => {
      const { createProvider } = await import('../../services/api.js');
      const { result } = renderHook(() => useProviderManager());

      const providerData = {
        name: 'claude',
        type: 'claude' as const,
        apiKey: 'test-key',
      };

      await result.current.addProvider(providerData);

      expect(createProvider).toHaveBeenCalledWith(providerData);
      expect(createProvider).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from createProvider', async () => {
      const { createProvider } = await import('../../services/api.js');
      const error = new Error('API error');
      vi.mocked(createProvider).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useProviderManager());

      await expect(
        result.current.addProvider({ name: 'test', type: 'claude' })
      ).rejects.toThrow('API error');
    });
  });

  describe('updateProvider', () => {
    it('calls updateProvider API with id and updates', async () => {
      const { updateProvider } = await import('../../services/api.js');
      const { result } = renderHook(() => useProviderManager());

      const updates = { apiKey: 'new-key' };

      await result.current.updateProvider('provider-1', updates);

      expect(updateProvider).toHaveBeenCalledWith('provider-1', updates);
      expect(updateProvider).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from updateProvider', async () => {
      const { updateProvider } = await import('../../services/api.js');
      const error = new Error('Update failed');
      vi.mocked(updateProvider).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useProviderManager());

      await expect(
        result.current.updateProvider('provider-1', { name: 'new-name' })
      ).rejects.toThrow('Update failed');
    });
  });

  describe('deleteProvider', () => {
    it('calls deleteProvider API with id', async () => {
      const { deleteProvider } = await import('../../services/api.js');
      const { result } = renderHook(() => useProviderManager());

      await result.current.deleteProvider('provider-1');

      expect(deleteProvider).toHaveBeenCalledWith('provider-1');
      expect(deleteProvider).toHaveBeenCalledTimes(1);
    });

    it('propagates errors from deleteProvider', async () => {
      const { deleteProvider } = await import('../../services/api.js');
      const error = new Error('Delete failed');
      vi.mocked(deleteProvider).mockRejectedValueOnce(error);

      const { result } = renderHook(() => useProviderManager());

      await expect(
        result.current.deleteProvider('provider-1')
      ).rejects.toThrow('Delete failed');
    });
  });

  describe('integration scenarios', () => {
    it('can perform CRUD operations in sequence', async () => {
      const { createProvider, updateProvider, deleteProvider } = await import('../../services/api.js');

      const { result } = renderHook(() => useProviderManager());

      // Create
      await result.current.addProvider({ name: 'test', type: 'claude' });
      expect(createProvider).toHaveBeenCalled();

      // Update
      await result.current.updateProvider('test-id', { name: 'updated' });
      expect(updateProvider).toHaveBeenCalled();

      // Delete
      await result.current.deleteProvider('test-id');
      expect(deleteProvider).toHaveBeenCalled();
    });
  });
});
