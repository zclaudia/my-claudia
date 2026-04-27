import { isDesktopTauri } from './platform';

export async function openWindowManagerWindow(): Promise<void> {
  if (!isDesktopTauri()) return;
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
  const existing = await WebviewWindow.getByLabel('window-manager');
  if (existing) {
    await existing.show().catch(() => {});
    await existing.setFocus().catch(() => {});
    return;
  }
  new WebviewWindow('window-manager', {
    url: `${window.location.origin}${window.location.pathname}?windowManager=1`,
    title: 'Windows — MyClaudia',
    width: 680,
    height: 480,
    center: true,
    resizable: true,
    dragDropEnabled: false,
  });
}
