import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../services/api', () => ({
  getMcpServers: vi.fn(),
  createMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
  deleteMcpServer: vi.fn(),
  toggleMcpServer: vi.fn(),
  importMcpServers: vi.fn(),
}));

import { useMcpServerStore } from '../../stores/mcpServerStore';
import * as api from '../../services/api';

describe('mcpServerStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useMcpServerStore.setState({ servers: [], isLoading: false, error: null });
  });

  it('has correct initial state', () => {
    const state = useMcpServerStore.getState();
    expect(state.servers).toEqual([]);
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  describe('fetchServers', () => {
    it('fetches and sets servers', async () => {
      const servers = [{ id: '1', name: 'test' }];
      vi.mocked(api.getMcpServers).mockResolvedValue(servers as any);

      await useMcpServerStore.getState().fetchServers();

      expect(useMcpServerStore.getState().servers).toEqual(servers);
      expect(useMcpServerStore.getState().isLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      vi.mocked(api.getMcpServers).mockRejectedValue(new Error('fail'));

      await useMcpServerStore.getState().fetchServers();

      expect(useMcpServerStore.getState().error).toBe('fail');
      expect(useMcpServerStore.getState().isLoading).toBe(false);
    });
  });

  describe('addServer', () => {
    it('adds server to list', async () => {
      const newServer = { id: '2', name: 'new' };
      vi.mocked(api.createMcpServer).mockResolvedValue(newServer as any);

      const result = await useMcpServerStore.getState().addServer({ name: 'new', command: 'cmd' });

      expect(result).toEqual(newServer);
      expect(useMcpServerStore.getState().servers).toContainEqual(newServer);
    });
  });

  describe('editServer', () => {
    it('updates server in list', async () => {
      const updated = { id: '1', name: 'updated' };
      vi.mocked(api.updateMcpServer).mockResolvedValue(updated as any);
      useMcpServerStore.setState({ servers: [{ id: '1', name: 'old' }] as any });

      await useMcpServerStore.getState().editServer('1', { name: 'updated' });

      expect(useMcpServerStore.getState().servers[0].name).toBe('updated');
    });
  });

  describe('removeServer', () => {
    it('removes server from list', async () => {
      vi.mocked(api.deleteMcpServer).mockResolvedValue(undefined as any);
      useMcpServerStore.setState({ servers: [{ id: '1', name: 'test' }] as any });

      await useMcpServerStore.getState().removeServer('1');

      expect(useMcpServerStore.getState().servers).toHaveLength(0);
    });
  });

  describe('toggle', () => {
    it('toggles server enabled state', async () => {
      const toggled = { id: '1', name: 'test', enabled: false };
      vi.mocked(api.toggleMcpServer).mockResolvedValue(toggled as any);
      useMcpServerStore.setState({ servers: [{ id: '1', name: 'test', enabled: true }] as any });

      await useMcpServerStore.getState().toggle('1');

      expect(useMcpServerStore.getState().servers[0]).toEqual(toggled);
    });
  });

  describe('importFromClaude', () => {
    it('imports and adds servers', async () => {
      const imported = [{ id: '3', name: 'imported' }];
      vi.mocked(api.importMcpServers).mockResolvedValue({ imported, skipped: [] } as any);

      const result = await useMcpServerStore.getState().importFromClaude();

      expect(result.imported).toEqual(imported);
      expect(useMcpServerStore.getState().servers).toContainEqual(imported[0]);
    });

    it('does not add when nothing imported', async () => {
      vi.mocked(api.importMcpServers).mockResolvedValue({ imported: [], skipped: ['a'] } as any);
      useMcpServerStore.setState({ servers: [{ id: '1' }] as any });

      await useMcpServerStore.getState().importFromClaude();

      expect(useMcpServerStore.getState().servers).toHaveLength(1);
    });
  });
});
