import type { NotificationConfig } from '@my-claudia/shared';
import { useGatewayStore } from '../../stores/gatewayStore';

/**
 * Notification config lives on the gateway (not the backend).
 * Requests go directly to the gateway HTTP endpoint.
 * No gateway = notifications not available.
 */
function resolveGatewayUrl(path: string): string | null {
  const { gatewayUrl } = useGatewayStore.getState();
  if (!gatewayUrl) return null;
  const httpUrl = gatewayUrl.includes('://')
    ? gatewayUrl.replace(/^ws/, 'http')
    : `http://${gatewayUrl}`;
  return `${httpUrl}${path}`;
}

function getAuthHeaders(): Record<string, string> {
  const { gatewaySecret } = useGatewayStore.getState();
  if (!gatewaySecret) return {};
  return {
    Authorization: `Bearer ${gatewaySecret}`,
    'Content-Type': 'application/json',
  };
}

async function gatewayFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = resolveGatewayUrl(path);
  if (!url) throw new Error('No gateway connection — notification config is not available');

  const headers = { ...getAuthHeaders(), ...options?.headers };
  const response = await fetch(url, { ...options, headers });
  const json = await response.json();

  if (!json.success) {
    throw new Error(json.error?.message || `Gateway API call failed: ${path}`);
  }
  return json.data as T;
}

export function isNotificationConfigAvailable(): boolean {
  return resolveGatewayUrl('/api/notifications/config') !== null;
}

export async function getNotificationConfig(): Promise<NotificationConfig> {
  return gatewayFetch<NotificationConfig>('/api/notifications/config');
}

export async function updateNotificationConfig(config: NotificationConfig): Promise<void> {
  await gatewayFetch<void>('/api/notifications/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function sendTestNotification(): Promise<void> {
  await gatewayFetch<void>('/api/notifications/test', { method: 'POST' });
}
