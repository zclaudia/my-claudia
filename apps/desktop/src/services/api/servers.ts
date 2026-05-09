import type { ServerInfo, ApiResponse } from '@my-claudia/shared';

import { resolveGatewayBackendUrl } from '../gatewayProxy';
import { useServerStore } from '../../stores/serverStore';
import { getControlPlaneMode, isLocalBackendId } from '../../utils/controlPlane';

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
  const localPort = useServerStore.getState().localServerPort;
  const controlPlaneMode = getControlPlaneMode();

  if (serverId) {
    if (controlPlaneMode === 'embedded-local' && isLocalBackendId(serverId)) {
      if (!localPort) return null;
      return `http://localhost:${localPort}`;
    }
    return resolveGatewayBackendUrl(serverId);
  }

  if (!localPort) return null;
  return `http://localhost:${localPort}`;
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

export interface AgentConfig {
  id?: number;
  enabled: boolean;
  projectId: string | null;
  sessionId: string | null;
  providerId: string | null;
  permissionWorkflowOverrideId: string | null;
  permissionPolicy: string | null;
}

export async function getAgentConfig(): Promise<AgentConfig> {
  const { fetchLocalApi } = await import('./base');
  const result = await fetchLocalApi<AgentConfig>('/api/agent/config');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get agent config');
  }
  return result.data;
}

export async function updateAgentConfig(config: {
  enabled?: boolean;
  providerId?: string | null;
  permissionWorkflowOverrideId?: string | null;
  permissionPolicy?: string | null;
}): Promise<AgentConfig> {
  const { fetchLocalApi } = await import('./base');
  const result = await fetchLocalApi<AgentConfig>('/api/agent/config', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update agent config');
  }
  return result.data;
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

export async function getProcessInfo(pid: number, backendId?: string | null): Promise<ProcessInfo> {
  const { fetchApiForBackend } = await import('./base');
  const result = await fetchApiForBackend<ProcessInfo>(`/api/system/process-info/${pid}`, backendId);
  if (!result.success || !result.data) return { alive: false, pid };
  return result.data;
}
