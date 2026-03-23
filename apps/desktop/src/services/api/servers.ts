import type { ServerInfo, ApiResponse } from '@my-claudia/shared';
import { isGatewayTarget, parseBackendId } from '../../stores/gatewayStore';
import { resolveGatewayBackendUrl } from '../gatewayProxy';
import { useServerStore } from '../../stores/serverStore';

/**
 * Get server info (including whether authentication is required).
 * This endpoint doesn't require authentication.
 */
export async function getServerInfo(address: string): Promise<ServerInfo> {
  const url = address.includes('://') ? address : `http://${address}`;
  const response = await fetch(`${url}/api/server/info`);
  const result: ApiResponse<ServerInfo> = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get server info');
  }
  return result.data;
}

function resolveProbeBaseUrl(serverId: string): string | null {
  if (isGatewayTarget(serverId)) {
    const backendId = parseBackendId(serverId);
    return resolveGatewayBackendUrl(backendId);
  }

  const server = useServerStore.getState().servers.find((item) => item.id === serverId);
  if (!server) return null;
  return server.address.includes('://') ? server.address : `http://${server.address}`;
}

export async function probeServerLatency(serverId: string, timeoutMs = 5000): Promise<number | null> {
  const baseUrl = resolveProbeBaseUrl(serverId);
  if (!baseUrl) return null;

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = performance.now();

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!response.ok) return null;
    return Math.round(performance.now() - startedAt);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

// Agent API
export async function ensureAgent(): Promise<{ projectId: string; sessionId: string }> {
  const { fetchLocalApi } = await import('./base');
  const result = await fetchLocalApi<{ projectId: string; sessionId: string }>('/api/agent/ensure', {
    method: 'POST'
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to ensure agent');
  }
  return result.data;
}

export async function getAgentConfig(): Promise<{
  enabled: boolean;
  projectId: string | null;
  sessionId: string | null;
  providerId: string | null;
  permissionPolicy: string | null;
}> {
  const { fetchApi } = await import('./base');
  const result = await fetchApi<any>('/api/agent/config');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get agent config');
  }
  return result.data;
}

export async function updateAgentConfig(config: {
  enabled?: boolean;
  providerId?: string;
  permissionPolicy?: string;
}): Promise<void> {
  const { fetchApi } = await import('./base');
  const result = await fetchApi<void>('/api/agent/config', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update agent config');
  }
}

// Process Info API
export interface ProcessInfo {
  alive: boolean;
  pid: number;
  ppid?: number;
  elapsedSeconds?: number;
  command?: string;
  args?: string;
}

export async function getProcessInfo(pid: number): Promise<ProcessInfo> {
  const { fetchApi } = await import('./base');
  const result = await fetchApi<ProcessInfo>(`/api/system/process-info/${pid}`);
  if (!result.success || !result.data) return { alive: false, pid };
  return result.data;
}
