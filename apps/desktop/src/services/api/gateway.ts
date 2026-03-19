import type { ServerGatewayConfig, ServerGatewayStatus } from '@my-claudia/shared';
import { fetchLocalApi } from './base';

/**
 * Get server Gateway configuration (local only)
 */
export async function getServerGatewayConfig(): Promise<ServerGatewayConfig> {
  const result = await fetchLocalApi<ServerGatewayConfig>('/api/server/gateway/config');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get gateway config');
  }
  return result.data;
}

/**
 * Update server Gateway configuration (local only)
 */
export async function updateServerGatewayConfig(config: {
  enabled?: boolean;
  gatewayUrl?: string;
  gatewaySecret?: string;
  backendName?: string;
}): Promise<ServerGatewayConfig> {
  const result = await fetchLocalApi<ServerGatewayConfig>('/api/server/gateway/config', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update gateway config');
  }
  return result.data;
}

/**
 * Get server Gateway status (local only)
 */
export async function getServerGatewayStatus(): Promise<ServerGatewayStatus> {
  const result = await fetchLocalApi<ServerGatewayStatus>('/api/server/gateway/status');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get gateway status');
  }
  return result.data;
}

/**
 * Connect server to Gateway (local only)
 */
export async function connectServerToGateway(): Promise<{ message: string }> {
  const result = await fetchLocalApi<{ message: string }>('/api/server/gateway/connect', {
    method: 'POST'
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to connect to gateway');
  }
  return result.data;
}

/**
 * Disconnect server from Gateway (local only)
 */
export async function disconnectServerFromGateway(): Promise<{ message: string }> {
  const result = await fetchLocalApi<{ message: string }>('/api/server/gateway/disconnect', {
    method: 'POST'
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to disconnect from gateway');
  }
  return result.data;
}
