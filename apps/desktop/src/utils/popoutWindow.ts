/**
 * Shared utilities for creating Tauri pop-out windows.
 * Centralizes connection param gathering, URL building, and WebviewWindow creation.
 */
import { useServerStore } from '../stores/serverStore';
import { useFacadeStore } from '../stores/facadeStore';
import { useGatewayStore, isGatewayTarget } from '../stores/gatewayStore';
import { getBaseUrl, getAuthHeaders } from '../services/api/base';

export interface ConnectionParams {
  serverUrl: string;
  authToken: string;
  serverId: string;
  serverName: string;
  gatewayUrl?: string;
  gatewaySecret?: string;
}

/** Gather current connection params from stores (serverUrl, auth, gateway). */
export function getConnectionParams(): ConnectionParams {
  let serverUrl = '';
  try { serverUrl = getBaseUrl(); } catch { /* no server */ }
  const authToken = (getAuthHeaders() as Record<string, string>)['Authorization'] || '';

  const serverState = useServerStore.getState();
  const activeServerId = serverState.activeServerId || '';
  const activeBackend = useFacadeStore.getState().backends.find(b => b.backendId === activeServerId);
  const serverName = activeBackend?.name || '';
  const gatewayState = useGatewayStore.getState();

  const result: ConnectionParams = { serverUrl, authToken, serverId: activeServerId, serverName };
  if (isGatewayTarget(activeServerId) && gatewayState.gatewayUrl && gatewayState.gatewaySecret) {
    result.gatewayUrl = gatewayState.gatewayUrl;
    result.gatewaySecret = gatewayState.gatewaySecret;
  }
  return result;
}

/** Build a pop-out window URL with connection params + custom params. */
export function buildPopoutUrl(windowParams: Record<string, string>): string {
  const conn = getConnectionParams();
  const params = new URLSearchParams({ ...windowParams, serverUrl: conn.serverUrl });
  if (conn.authToken) params.set('authToken', conn.authToken);
  if (conn.serverId) params.set('serverId', conn.serverId);
  if (conn.serverName) params.set('serverName', conn.serverName);
  if (conn.gatewayUrl) params.set('gatewayUrl', conn.gatewayUrl);
  if (conn.gatewaySecret) params.set('gatewaySecret', conn.gatewaySecret);
  return `${window.location.origin}${window.location.pathname}?${params}`;
}

export interface PopoutWindowOptions {
  /** Label prefix, e.g. 'session-chat', 'terminal'. Full label: `${type}-${Date.now()}` */
  type: string;
  /** Window-specific URL params (e.g. { sessionWindow: sessionId, projectId }) */
  params: Record<string, string>;
  title: string;
  width?: number;
  height?: number;
  dragDropEnabled?: boolean;
}

/**
 * Open a Tauri pop-out window with connection params auto-injected.
 * Returns the window label for tracking.
 */
export async function openPopoutWindow(options: PopoutWindowOptions): Promise<string> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const label = `${options.type}-${Date.now()}`;
  const url = buildPopoutUrl(options.params);

  new WebviewWindow(label, {
    url,
    title: options.title,
    width: options.width ?? 900,
    height: options.height ?? 700,
    center: true,
    dragDropEnabled: options.dragDropEnabled ?? false,
  });

  return label;
}

/** Build a descriptive window title: "Name — Context1 · Context2" */
export function buildWindowTitle(name: string, ...contextParts: (string | undefined)[]): string {
  const filtered = contextParts.filter(Boolean) as string[];
  if (filtered.length === 0) return name;
  return `${name} — ${filtered.join(' · ')}`;
}

/** Parse connection params from current URL (used by pop-out window receivers). */
export function parseWindowConnectionParams(): ConnectionParams {
  const params = new URLSearchParams(window.location.search);
  return {
    serverUrl: params.get('serverUrl') || '',
    authToken: params.get('authToken') || '',
    serverId: params.get('serverId') || '',
    serverName: params.get('serverName') || '',
    gatewayUrl: params.get('gatewayUrl') || undefined,
    gatewaySecret: params.get('gatewaySecret') || undefined,
  };
}
