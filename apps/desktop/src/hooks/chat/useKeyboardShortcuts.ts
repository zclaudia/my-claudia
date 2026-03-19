import { useEffect } from 'react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { usePluginStore } from '../../stores/pluginStore';

interface UseKeyboardShortcutsOptions {
  projectId: string | undefined;
  projectRoot: string | undefined;
}

export function useKeyboardShortcuts({ projectId, projectRoot }: UseKeyboardShortcutsOptions) {
  // Ctrl+` keyboard shortcut to toggle terminal
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === '`' && projectId && !usePluginStore.getState().disabledBuiltinPanels.includes('terminal')) {
        e.preventDefault();
        const store = useTerminalStore.getState();
        const bpStore = useBottomPanelStore.getState();
        if (store.isDrawerOpen(projectId) && bpStore.activeTab === 'terminal') {
          store.setDrawerOpen(projectId, false);
        } else if (store.isDrawerOpen(projectId)) {
          bpStore.setActiveTab('terminal');
        } else {
          if (!store.terminals[projectId]) {
            store.openTerminal(projectId);
          }
          store.setDrawerOpen(projectId, true);
          bpStore.setActiveTab('terminal');
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectId]);

  // Cmd+P / Ctrl+P keyboard shortcut to open file search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'p' && projectRoot && !usePluginStore.getState().disabledBuiltinPanels.includes('file-viewer')) {
        e.preventDefault();
        const store = useFileViewerStore.getState();
        if (!store.isOpen) {
          store.togglePanel();
        }
        store.setSearchOpen(true);
        useBottomPanelStore.getState().setActiveTab('file-viewer');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [projectRoot]);
}
