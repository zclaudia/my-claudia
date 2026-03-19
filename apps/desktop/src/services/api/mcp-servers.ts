import type { McpServerConfig } from '@my-claudia/shared';
import { fetchLocalApi } from './base';

export async function getMcpServers(): Promise<McpServerConfig[]> {
  const result = await fetchLocalApi<McpServerConfig[]>('/api/mcp-servers');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch MCP servers');
  }
  return result.data;
}

export async function createMcpServer(config: {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  description?: string;
  providerScope?: string[];
}): Promise<McpServerConfig> {
  const result = await fetchLocalApi<McpServerConfig>('/api/mcp-servers', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create MCP server');
  }
  return result.data;
}

export async function updateMcpServer(id: string, config: Partial<{
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  description: string;
  providerScope: string[];
}>): Promise<McpServerConfig> {
  const result = await fetchLocalApi<McpServerConfig>(`/api/mcp-servers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update MCP server');
  }
  return result.data;
}

export async function deleteMcpServer(id: string): Promise<void> {
  const result = await fetchLocalApi<null>(`/api/mcp-servers/${id}`, {
    method: 'DELETE',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete MCP server');
  }
}

export async function toggleMcpServer(id: string): Promise<McpServerConfig> {
  const result = await fetchLocalApi<McpServerConfig>(`/api/mcp-servers/${id}/toggle`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to toggle MCP server');
  }
  return result.data;
}

export async function importMcpServers(): Promise<{ imported: McpServerConfig[]; skipped: string[] }> {
  const result = await fetchLocalApi<{ imported: McpServerConfig[]; skipped: string[] }>('/api/mcp-servers/import', {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to import MCP servers');
  }
  return result.data;
}
