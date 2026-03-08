/**
 * MCP Server Store - Zustand store for MCP server management UI state
 */

import { create } from 'zustand';
import type { McpServerConfig } from '@my-claudia/shared';
import {
  getMcpServers,
  createMcpServer,
  updateMcpServer,
  deleteMcpServer,
  toggleMcpServer,
  importMcpServers,
} from '../services/api';

interface McpServerStoreState {
  servers: McpServerConfig[];
  isLoading: boolean;
  error: string | null;

  fetchServers: () => Promise<void>;
  addServer: (config: {
    name: string;
    command: string;
    args?: string[];
    env?: Record<string, string>;
    enabled?: boolean;
    description?: string;
    providerScope?: string[];
  }) => Promise<McpServerConfig>;
  editServer: (id: string, config: Partial<{
    name: string;
    command: string;
    args: string[];
    env: Record<string, string>;
    enabled: boolean;
    description: string;
    providerScope: string[];
  }>) => Promise<void>;
  removeServer: (id: string) => Promise<void>;
  toggle: (id: string) => Promise<void>;
  importFromClaude: () => Promise<{ imported: McpServerConfig[]; skipped: string[] }>;
}

export const useMcpServerStore = create<McpServerStoreState>((set, get) => ({
  servers: [],
  isLoading: false,
  error: null,

  fetchServers: async () => {
    set({ isLoading: true, error: null });
    try {
      const servers = await getMcpServers();
      set({ servers, isLoading: false });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), isLoading: false });
    }
  },

  addServer: async (config) => {
    const server = await createMcpServer(config);
    set({ servers: [...get().servers, server] });
    return server;
  },

  editServer: async (id, config) => {
    const updated = await updateMcpServer(id, config);
    set({ servers: get().servers.map(s => s.id === id ? updated : s) });
  },

  removeServer: async (id) => {
    await deleteMcpServer(id);
    set({ servers: get().servers.filter(s => s.id !== id) });
  },

  toggle: async (id) => {
    const updated = await toggleMcpServer(id);
    set({ servers: get().servers.map(s => s.id === id ? updated : s) });
  },

  importFromClaude: async () => {
    const result = await importMcpServers();
    if (result.imported.length > 0) {
      set({ servers: [...get().servers, ...result.imported] });
    }
    return result;
  },
}));
