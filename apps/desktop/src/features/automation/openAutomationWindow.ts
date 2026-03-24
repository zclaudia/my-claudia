/**
 * Open the Automation management panel as a standalone Tauri window.
 */

import { getBaseUrl, getAuthHeaders } from '../../services/api';

export async function openAutomationWindow(): Promise<string> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');

  const label = `automation-${Date.now()}`;
  const serverUrl = getBaseUrl();
  const authToken = (getAuthHeaders() as Record<string, string>)['Authorization'] || '';

  const params = new URLSearchParams();
  params.set('automationWindow', '1');
  params.set('serverUrl', serverUrl);
  params.set('authToken', authToken);

  const url = `${window.location.origin}${window.location.pathname}?${params.toString()}`;

  new WebviewWindow(label, {
    url,
    title: 'Automation',
    width: 1000,
    height: 700,
    center: true,
    dragDropEnabled: false,
  });

  return label;
}
