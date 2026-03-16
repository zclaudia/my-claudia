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
import { useTerminalStore } from '../stores/terminalStore';
import { useFileViewerStore } from '../stores/fileViewerStore';

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
      // Find the active project and close its terminal drawer
      const { drawerOpen, setDrawerOpen } = useTerminalStore.getState();
      for (const [pid, open] of Object.entries(drawerOpen)) {
        if (open) setDrawerOpen(pid, false);
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

  // Server plugin panels (system-monitor, notes-board, etc.) are registered
  // dynamically via `plugin_panel_registered` messages from the backend.
}
