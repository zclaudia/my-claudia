/**
 * Open the Automation management panel as a standalone Tauri window.
 * Single-instance: reuses an existing window via focus + Tauri event if already open.
 */

import { buildPopoutUrl, getConnectionParams } from '../../utils/popoutWindow';
import { resolveLocalBackendId } from '../../utils/controlPlane';

export const AUTOMATION_WINDOW_LABEL = 'automation';

export interface OpenAutomationWindowOptions {
  tab?: 'automations' | 'workflows';
  projectId?: string;
}

export async function openAutomationWindow(opts: OpenAutomationWindowOptions = {}): Promise<void> {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');

  const existing = await WebviewWindow.getByLabel(AUTOMATION_WINDOW_LABEL);
  if (existing) {
    await existing.setFocus();
    const { emitTo } = await import('@tauri-apps/api/event');
    await emitTo(AUTOMATION_WINDOW_LABEL, 'automation:navigate', {
      tab: opts.tab ?? 'automations',
      projectId: opts.projectId,
    });
    return;
  }

  const connectionTarget = { backendId: resolveLocalBackendId() };
  const params: Record<string, string> = { automationWindow: '1' };
  if (opts.tab) params.initialTab = opts.tab;
  if (opts.projectId) params.initialProjectId = opts.projectId;

  const url = buildPopoutUrl(params, connectionTarget);
  const conn = getConnectionParams(connectionTarget);

  new WebviewWindow(AUTOMATION_WINDOW_LABEL, {
    url,
    title: conn.serverName ? `Automation · ${conn.serverName}` : 'Automation',
    width: 1000,
    height: 700,
    center: true,
    dragDropEnabled: false,
  });
}
