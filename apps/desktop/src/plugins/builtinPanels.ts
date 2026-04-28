/**
 * Builtin Plugin Panels
 *
 * Registers frontend React components for built-in server plugins
 * and core UI panels (Terminal, File Viewer).
 *
 * Called once on app startup so plugin commands that trigger showPanel()
 * have a component ready to render in the bottom panel area.
 */
import { usePluginStore } from '../stores/pluginStore';
import { TerminalPanel, TerminalActions } from '../components/terminal/TerminalPanel';
import { FileViewerPanel, FileViewerActions } from '../components/fileviewer/FileViewerPanel';
import { DraftPanel } from '../components/draft/DraftPanel';
import { NotificationsPanel } from '../components/notifications/NotificationsPanel';
import { useTerminalStore } from '../stores/terminalStore';
import { useFileViewerStore } from '../stores/fileViewerStore';
import { useDraftEditorStore } from '../stores/draftEditorStore';


export function initBuiltinPanels() {
  const { registerPanel } = usePluginStore.getState();

  // --- Core panels ---

  // Terminal: always mounted to preserve xterm WebGL state, visibility toggled by user
  registerPanel({
    id: 'terminal',
    pluginId: 'com.claudia.terminal',
    type: 'panel',
    label: 'Terminal',
    icon: 'Terminal',
    component: TerminalPanel,
    actions: TerminalActions,
    order: 0,
    platforms: ['desktop', 'mobile'],
    alwaysMount: true,
    visible: false,
    onClose: () => {
      // Close all open terminal drawers across backend/project scopes.
      const { drawerOpen } = useTerminalStore.getState();
      for (const scopeKey of Object.keys(drawerOpen)) {
        if (!drawerOpen[scopeKey]) continue;
        const separatorIndex = scopeKey.indexOf('::');
        const projectId = separatorIndex >= 0 ? scopeKey.slice(separatorIndex + 2) : scopeKey;
        const backendId = separatorIndex >= 0 ? scopeKey.slice(0, separatorIndex) : undefined;
        useTerminalStore.getState().setDrawerOpen(projectId, false, backendId === 'no-backend' ? null : backendId);
      }
    },
  });

  // File Viewer: dynamically registered/unregistered by fileViewerStore open/close
  // Register here as hidden so it's ready; fileViewerStore.openFile will make it visible
  registerPanel({
    id: 'file-viewer',
    pluginId: 'com.claudia.file-viewer',
    type: 'panel',
    label: 'File',
    icon: 'File',
    component: FileViewerPanel,
    actions: FileViewerActions,
    order: 1,
    platforms: ['desktop', 'mobile'],
    alwaysMount: false,
    visible: false,
    onClose: () => {
      useFileViewerStore.getState().close();
    },
  });

  // Draft Editor: dynamically shown when a draft is opened, hidden on close
  registerPanel({
    id: 'draft',
    pluginId: 'com.claudia.draft',
    type: 'panel',
    label: 'Draft',
    icon: 'FileEdit',
    component: DraftPanel,
    actions: undefined,
    order: 2,
    platforms: ['desktop', 'mobile'],
    alwaysMount: false,
    visible: false,
    onClose: () => {
      useDraftEditorStore.getState().closeEditor();
    },
  });

  registerPanel({
    id: 'notifications',
    pluginId: 'com.claudia.notifications',
    type: 'panel',
    label: 'Notifications',
    icon: 'Activity',
    component: NotificationsPanel,
    order: 3,
    platforms: ['desktop', 'mobile'],
    alwaysMount: false,
    visible: false,
    onClose: () => {
      usePluginStore.getState().updatePanelVisibility('notifications', false);
    },
  });

  // Server plugin panels (system-monitor, notes-board, etc.) are registered
  // dynamically via `plugin_panel_registered` messages from the backend.
}
