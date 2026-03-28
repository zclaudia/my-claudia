/**
 * Open the Automation management panel as a standalone Tauri window.
 */

import { openPopoutWindow } from '../../utils/popoutWindow';
import { resolveLocalBackendId } from '../../utils/controlPlane';

export async function openAutomationWindow(): Promise<string> {
  return openPopoutWindow({
    type: 'automation',
    params: { automationWindow: '1' },
    title: 'Automation',
    width: 1000,
    connectionTarget: { backendId: resolveLocalBackendId() },
  });
}
