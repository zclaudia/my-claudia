import type { NotificationConfig } from '@my-claudia/shared';
import { invoke } from '@tauri-apps/api/core';
import { isAndroid } from '../utils/platform';

const BRIDGE_URL = 'http://127.0.0.1:9595';
const RECEIVER = 'com.myClaudia.mobile.NotificationRenderService';

export interface NtfyBridgeStatusResponse {
  ok: boolean;
  uptime?: string;
  version?: string;
  subscriptions: Record<string, unknown>;
}

async function bridgeFetch(path: string, options?: RequestInit): Promise<Response> {
  return fetch(`${BRIDGE_URL}${path}`, options);
}

async function getCurrentPackageId(): Promise<string> {
  const { getIdentifier } = await import('@tauri-apps/api/app');
  return getIdentifier();
}

export function isNtfyBridgeSupported(): boolean {
  return isAndroid();
}

export async function registerNtfySubscription(config: Pick<NotificationConfig, 'ntfyUrl' | 'ntfyTopic' | 'ntfyAuthMode' | 'ntfySubscribeToken' | 'ntfyUsername' | 'ntfyPassword'>): Promise<void> {
  if (!isNtfyBridgeSupported()) return;

  const packageId = await getCurrentPackageId();
  const authMode = config.ntfyAuthMode ?? 'none';
  const subscribeToken = config.ntfySubscribeToken?.trim() ?? '';
  const username = config.ntfyUsername?.trim() ?? '';
  const password = config.ntfyPassword ?? '';

  if (isAndroid()) {
    await invoke('android_sync_ntfy_bridge', {
      config: {
        enabled: true,
        ntfy_url: config.ntfyUrl,
        ntfy_topic: config.ntfyTopic,
        ntfy_auth_mode: authMode,
        ntfy_auth_token: subscribeToken,
        ntfy_username: username,
        ntfy_password: password,
      },
      packageId,
    });
    return;
  }

  const response = await bridgeFetch('/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: packageId,
      ntfy_url: config.ntfyUrl.trim(),
      topic: config.ntfyTopic.trim(),
      auth_mode: authMode,
      auth_token: subscribeToken,
      username,
      password,
      package: packageId,
      receiver: RECEIVER,
    }),
  });

  if (!response.ok) {
    throw new Error(`ntfy-bridge register failed: ${response.status}`);
  }
}

export async function unregisterNtfySubscription(): Promise<void> {
  if (!isNtfyBridgeSupported()) return;

  const packageId = await getCurrentPackageId();

  if (isAndroid()) {
    await invoke('android_sync_ntfy_bridge', {
      config: {
        enabled: false,
        ntfy_url: '',
        ntfy_topic: '',
        ntfy_auth_mode: 'none',
        ntfy_auth_token: '',
        ntfy_username: '',
        ntfy_password: '',
      },
      packageId,
    });
    return;
  }

  const response = await bridgeFetch('/subscribe', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: packageId }),
  });

  if (!response.ok) {
    throw new Error(`ntfy-bridge unregister failed: ${response.status}`);
  }
}

export async function syncNtfyBridgeRegistration(config: NotificationConfig): Promise<void> {
  if (!isNtfyBridgeSupported()) return;

  if (config.enabled && config.ntfyUrl.trim() && config.ntfyTopic.trim()) {
    await registerNtfySubscription({
      ntfyUrl: config.ntfyUrl,
      ntfyTopic: config.ntfyTopic,
      ntfyAuthMode: config.ntfyAuthMode,
      ntfySubscribeToken: config.ntfySubscribeToken,
      ntfyUsername: config.ntfyUsername,
      ntfyPassword: config.ntfyPassword,
    });
    return;
  }

  await unregisterNtfySubscription();
}

export async function getNtfyBridgeStatus(): Promise<NtfyBridgeStatusResponse> {
  if (!isNtfyBridgeSupported()) {
    return { ok: false, subscriptions: {} };
  }

  try {
    if (isAndroid()) {
      return await invoke<NtfyBridgeStatusResponse>('android_get_ntfy_bridge_status');
    }
    const response = await bridgeFetch('/status');
    if (!response.ok) {
      throw new Error(`status failed: ${response.status}`);
    }
    return await response.json() as NtfyBridgeStatusResponse;
  } catch {
    return { ok: false, subscriptions: {} };
  }
}
