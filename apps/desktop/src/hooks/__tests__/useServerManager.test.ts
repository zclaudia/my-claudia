import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useServerManager } from '../useServerManager.js';

// Mock the api module
vi.mock('../../services/api', () => ({
  getServers: vi.fn(),
  createServer: vi.fn(),
  updateServer: vi.fn(),
  deleteServer: vi.fn(),
}));

// Mock the serverStore
vi.mock('../../stores/serverStore', () => ({
  useServerStore: {
    getState: vi.fn(() => ({
      setServers: vi.fn(),
    })),
  },
}));

describe('hooks/useServerManager', () => {
  let mockGetServers: ReturnType<typeof vi.fn>;
  let mockCreateServer: ReturnType<typeof vi.fn>;
  let mockUpdateServer: ReturnType<typeof vi.fn>;
  let mockDeleteServer: ReturnType<typeof vi.fn>;
  let mockSetServers: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    const api = await import('../../services/api.js');
    mockGetServers = vi.mocked(api.getServers);
    mockCreateServer = vi.mocked(api.createServer);
    mockUpdateServer = vi.mocked(api.updateServer);
    mockDeleteServer = vi.mocked(api.deleteServer);

    const { useServerStore } = await import('../../stores/serverStore.js');
    mockSetServers = vi.fn();
    vi.mocked(useServerStore.getState).mockReturnValue({
      setServers: mockSetServers,
    } as any);
  });

  describe('return value', () => {
    it('returns all manager functions', () => {
      const { result } = renderHook(() => useServerManager());

      // Note: refreshServers is internal, not exported
      expect(result.current).toHaveProperty('addServer');
      expect(result.current).toHaveProperty('updateServer');
      expect(result.current).toHaveProperty('deleteServer');
      expect(result.current).toHaveProperty('setDefaultServer');

      expect(typeof result.current.addServer).toBe('function');
      expect(typeof result.current.updateServer).toBe('function');
      expect(typeof result.current.deleteServer).toBe('function');
      expect(typeof result.current.setDefaultServer).toBe('function');
    });

    it('returns stable function references', () => {
      const { result, rerender } = renderHook(() => useServerManager());

      const firstAddServer = result.current.addServer;
      const firstUpdateServer = result.current.updateServer;
      const firstDeleteServer = result.current.deleteServer;
      const firstSetDefaultServer = result.current.setDefaultServer;

      rerender();

      expect(result.current.addServer).toBe(firstAddServer);
      expect(result.current.updateServer).toBe(firstUpdateServer);
      expect(result.current.deleteServer).toBe(firstDeleteServer);
      expect(result.current.setDefaultServer).toBe(firstSetDefaultServer);
    });
  });

  describe('internal refresh', () => {
    it('fetches servers and updates store after add', async () => {
      const mockServers = [
        { id: 'server-1', name: 'Server 1', address: 'localhost:3000' },
      ];
      mockCreateServer.mockResolvedValueOnce({ id: 'new-server' });
      mockGetServers.mockResolvedValueOnce(mockServers);

      const { result } = renderHook(() => useServerManager());

      await result.current.addServer({ name: 'Test', address: 'localhost' } as any);

      expect(mockGetServers).toHaveBeenCalledTimes(1);
      expect(mockSetServers).toHaveBeenCalledWith(mockServers);
    });

    it('handles errors gracefully during refresh', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockCreateServer.mockResolvedValueOnce({ id: 'new' });
      mockGetServers.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useServerManager());

      // The addServer should complete without throwing even if refresh fails
      await result.current.addServer({ name: 'Test', address: 'localhost' } as any);

      expect(consoleSpy).toHaveBeenCalledWith(
        '[ServerManager] Failed to refresh servers:',
        expect.any(Error)
      );

      consoleSpy.mockRestore();
    });
  });

  describe('addServer', () => {
    it('creates server and refreshes list', async () => {
      mockCreateServer.mockResolvedValueOnce({ id: 'new-server' });
      mockGetServers.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useServerManager());

      const serverData = {
        name: 'New Server',
        address: 'localhost:4000',
      };

      await result.current.addServer(serverData as any);

      expect(mockCreateServer).toHaveBeenCalledWith(serverData);
      expect(mockGetServers).toHaveBeenCalled();
      expect(mockSetServers).toHaveBeenCalled();
    });

    it('propagates errors from createServer', async () => {
      mockCreateServer.mockRejectedValueOnce(new Error('Create failed'));

      const { result } = renderHook(() => useServerManager());

      await expect(
        result.current.addServer({ name: 'Test', address: 'localhost' } as any)
      ).rejects.toThrow('Create failed');
    });
  });

  describe('updateServer', () => {
    it('updates server and refreshes list', async () => {
      mockUpdateServer.mockResolvedValueOnce(undefined);
      mockGetServers.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useServerManager());

      const updates = { name: 'Updated Server' };

      await result.current.updateServer('server-1', updates);

      expect(mockUpdateServer).toHaveBeenCalledWith('server-1', updates);
      expect(mockGetServers).toHaveBeenCalled();
      expect(mockSetServers).toHaveBeenCalled();
    });

    it('propagates errors from updateServer', async () => {
      mockUpdateServer.mockRejectedValueOnce(new Error('Update failed'));

      const { result } = renderHook(() => useServerManager());

      await expect(
        result.current.updateServer('server-1', { name: 'Test' })
      ).rejects.toThrow('Update failed');
    });
  });

  describe('deleteServer', () => {
    it('deletes server and refreshes list', async () => {
      mockDeleteServer.mockResolvedValueOnce(undefined);
      mockGetServers.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useServerManager());

      await result.current.deleteServer('server-1');

      expect(mockDeleteServer).toHaveBeenCalledWith('server-1');
      expect(mockGetServers).toHaveBeenCalled();
      expect(mockSetServers).toHaveBeenCalled();
    });

    it('propagates errors from deleteServer', async () => {
      mockDeleteServer.mockRejectedValueOnce(new Error('Delete failed'));

      const { result } = renderHook(() => useServerManager());

      await expect(
        result.current.deleteServer('server-1')
      ).rejects.toThrow('Delete failed');
    });
  });

  describe('setDefaultServer', () => {
    it('sets server as default and refreshes list', async () => {
      mockUpdateServer.mockResolvedValueOnce(undefined);
      mockGetServers.mockResolvedValueOnce([]);

      const { result } = renderHook(() => useServerManager());

      await result.current.setDefaultServer('server-1');

      expect(mockUpdateServer).toHaveBeenCalledWith('server-1', { isDefault: true });
      expect(mockGetServers).toHaveBeenCalled();
      expect(mockSetServers).toHaveBeenCalled();
    });

    it('propagates errors from updateServer', async () => {
      mockUpdateServer.mockRejectedValueOnce(new Error('Set default failed'));

      const { result } = renderHook(() => useServerManager());

      await expect(
        result.current.setDefaultServer('server-1')
      ).rejects.toThrow('Set default failed');
    });
  });

  describe('integration scenarios', () => {
    it('can perform CRUD operations in sequence', async () => {
      mockCreateServer.mockResolvedValueOnce({ id: 'new' });
      mockUpdateServer.mockResolvedValueOnce(undefined);
      mockDeleteServer.mockResolvedValueOnce(undefined);
      mockGetServers.mockResolvedValue([]);

      const { result } = renderHook(() => useServerManager());

      // Add
      await result.current.addServer({ name: 'Test', address: 'localhost' } as any);
      expect(mockCreateServer).toHaveBeenCalled();

      // Update
      await result.current.updateServer('new', { name: 'Updated' });
      expect(mockUpdateServer).toHaveBeenCalled();

      // Set default
      await result.current.setDefaultServer('new');
      expect(mockUpdateServer).toHaveBeenCalledWith('new', { isDefault: true });

      // Delete
      await result.current.deleteServer('new');
      expect(mockDeleteServer).toHaveBeenCalled();

      // Should have called refresh (getServers) after each operation
      expect(mockGetServers).toHaveBeenCalledTimes(4);
    });
  });
});
