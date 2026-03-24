/**
 * Open the Automation management panel as a standalone Tauri window.
 */

import { openPopoutWindow } from '../../utils/popoutWindow';

export async function openAutomationWindow(): Promise<string> {
  return openPopoutWindow({
    type: 'automation',
    params: { automationWindow: '1' },
    title: 'Automation',
    width: 1000,
  });
}
