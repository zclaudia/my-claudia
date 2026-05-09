import { useEffect } from 'react';
import { useUIStore } from '../stores/uiStore';
import { useTerminalStore } from '../stores/terminalStore';
import { usePluginStore } from '../stores/pluginStore';
import { useDraftEditorStore } from '../stores/draftEditorStore';
import { terminalRegistry } from '../services/terminal/TerminalRegistry';

/**
 * Listens for Tauri window-closed events (session, terminal, draft)
 * and cleans up the corresponding UI state in the main window.
 * Skipped when running inside a pop-out session window itself.
 */
export function useTauriWindowEvents() {
  const removePoppedOutSession = useUIStore((s) => s.removePoppedOutSession);

  useEffect(() => {
    if (typeof window === 'undefined' || new URLSearchParams(window.location.search).has('sessionWindow')) {
      return;
    }

    let cleanupSession: (() => void) | undefined;
    let cleanupTerminal: (() => void) | undefined;
    let cleanupDraft: (() => void) | undefined;

    (async () => {
      const { listen } = await import('@tauri-apps/api/event');

      cleanupSession = await listen<{ sessionId?: string }>('session-window-closed', (event) => {
        const closedSessionId = event.payload?.sessionId;
        if (closedSessionId) {
          removePoppedOutSession(closedSessionId);
        }
      });

      cleanupTerminal = await listen<{ terminalId?: string }>('terminal-window-closed', (event) => {
        const closedTerminalId = event.payload?.terminalId;
        if (!closedTerminalId) return;
        useTerminalStore.getState().removePoppedOutTerminal(closedTerminalId);
        // Make the panel visible first so the bound container is in the DOM tree before claim()
        // re-mounts xterm into it.
        usePluginStore.getState().updatePanelVisibility('terminal', true);
        terminalRegistry.get(closedTerminalId)?.claim();
      });

      cleanupDraft = await listen<{ sessionId?: string }>('draft-window-closed', () => {
        useDraftEditorStore.getState().setPoppedOut(false, null);
      });
    })();

    return () => {
      cleanupSession?.();
      cleanupTerminal?.();
      cleanupDraft?.();
    };
  }, [removePoppedOutSession]);
}
