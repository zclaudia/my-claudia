/**
 * Open a plugin panel as a standalone Tauri window.
 *
 * Uses the same query-param routing pattern as other pop-out windows
 * (session, terminal, draft, file viewer).
 */

import { getBaseUrl, getAuthHeaders } from '../services/api';

export interface OpenPluginWindowOptions {
  pluginId: string;
  panelId: string;
  title: string;
  width?: number;
  height?: number;
  iframeUrl?: string;
  extraParams?: Record<string, string>;
}

/**
 * Opens a plugin panel in a standalone window.
 * Returns the window label (useful for tracking/closing).
 */
export async function openPluginWindow(options: OpenPluginWindowOptions): Promise<string> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');

  const label = `plugin-${options.pluginId.replace(/\./g, '-')}-${Date.now()}`;

  // Build URL with connection params inherited from current context
  const serverUrl = getBaseUrl();
  const authToken = (getAuthHeaders() as Record<string, string>)['Authorization'] || '';

  const params = new URLSearchParams();
  params.set('pluginWindow', options.pluginId);
  params.set('panelId', options.panelId);
  params.set('serverUrl', serverUrl);
  params.set('authToken', authToken);
  if (options.iframeUrl) {
    params.set('iframeUrl', options.iframeUrl);
  }

  // Add extra params
  if (options.extraParams) {
    for (const [key, value] of Object.entries(options.extraParams)) {
      params.set(key, value);
    }
  }

  const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

  new WebviewWindow(label, {
    url,
    title: options.title,
    width: options.width || 800,
    height: options.height || 600,
    center: true,
    dragDropEnabled: false,
  });

  return label;
}
