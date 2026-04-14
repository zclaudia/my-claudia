import type { NotificationConfig } from '@my-claudia/shared';
import type { NtfyBridgeStatusResponse } from '../ntfyBridge';
import { resolveGatewayDirectUrl, getGatewayAuthHeaders } from '../gatewayProxy';
import { getNtfyBridgeStatus, syncNtfyBridgeRegistration } from '../ntfyBridge';

/**
 * Notification config lives on the gateway (not the backend).
 * Desktop routes through the local backend proxy (SOCKS5-aware);
 * mobile connects to the gateway directly.
 */

async function gatewayFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const url = resolveGatewayDirectUrl(path);
  if (!url) throw new Error('No gateway connection — notification config is not available');

  const headers = { ...getGatewayAuthHeaders(), 'Content-Type': 'application/json', ...options?.headers };
  const response = await fetch(url, { ...options, headers });
  const json = await response.json();

  if (!json.success) {
    throw new Error(json.error?.message || `Gateway API call failed: ${path}`);
  }
  return json.data as T;
}

export function isNotificationConfigAvailable(): boolean {
  return resolveGatewayDirectUrl('/api/notifications/config') !== null;
}

export async function getNotificationConfig(): Promise<NotificationConfig> {
  return gatewayFetch<NotificationConfig>('/api/notifications/config');
}

export async function refreshNotificationConfig(): Promise<NotificationConfig | null> {
  if (!isNotificationConfigAvailable()) return null;
  const config = await getNotificationConfig();
  await syncLocalNotificationBridge(config);
  return config;
}

export async function syncLocalNotificationBridge(config: NotificationConfig): Promise<void> {
  await syncNtfyBridgeRegistration(config);
}

export async function getLocalNotificationBridgeStatus(): Promise<NtfyBridgeStatusResponse> {
  return getNtfyBridgeStatus();
}

export async function sendTestNotification(): Promise<void> {
  await gatewayFetch<void>('/api/notifications/test', { method: 'POST' });
}
