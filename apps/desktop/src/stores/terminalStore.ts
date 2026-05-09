import { create } from 'zustand';
import { usePluginStore } from './pluginStore';
import { useServerStore } from './serverStore';

export function getTerminalScopeKey(projectId: string, backendId: string | null | undefined): string {
  return `${backendId ?? 'no-backend'}::${projectId}`;
}

interface TerminalState {
  // Active terminal per backend/project scope (backendId::projectId → terminalId)
  terminals: Record<string, string>;
  // Terminals that have received first output (shell prompt ready)
  readyTerminals: Set<string>;
  // Drawer open state per backend/project scope (backendId::projectId → boolean)
  drawerOpen: Record<string, boolean>;
  // Sticky Ctrl key per terminal (auto-disables after one keystroke)
  ctrlActive: Record<string, boolean>;
  // Terminals popped out to separate windows (terminalId → windowLabel)
  poppedOutTerminals: Record<string, string>;
  openTerminal: (projectId: string, backendId?: string | null) => string;
  closeTerminal: (terminalId: string) => void;
  setDrawerOpen: (projectId: string, open: boolean, backendId?: string | null) => void;
  isDrawerOpen: (projectId: string, backendId?: string | null) => boolean;
  toggleCtrl: (terminalId: string) => void;
  handleTerminalExited: (terminalId: string) => void;
  getTerminalId: (projectId: string, backendId?: string | null) => string | undefined;
  markReady: (terminalId: string) => void;
  isReady: (terminalId: string) => boolean;
  /** Returns a promise that resolves when the terminal is ready (shell loaded). */
  waitForReady: (terminalId: string, timeoutMs?: number) => Promise<boolean>;
  addPoppedOutTerminal: (terminalId: string, windowLabel: string) => void;
  removePoppedOutTerminal: (terminalId: string) => void;
  isTerminalPoppedOut: (terminalId: string) => boolean;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: {},
  readyTerminals: new Set<string>(),
  drawerOpen: {},
  ctrlActive: {},
  poppedOutTerminals: {},
  openTerminal: (projectId: string, backendId) => {
    const scopeKey = getTerminalScopeKey(projectId, backendId ?? useServerStore.getState().activeServerId);
    const existing = get().terminals[scopeKey];
    if (existing) return existing;
    const terminalId = crypto.randomUUID();
    set((state) => ({
      terminals: { ...state.terminals, [scopeKey]: terminalId },
    }));
    return terminalId;
  },

  closeTerminal: (terminalId: string) => {
    set((state) => {
      const terminals = { ...state.terminals };
      for (const [pid, tid] of Object.entries(terminals)) {
        if (tid === terminalId) {
          delete terminals[pid];
          break;
        }
      }
      const readyTerminals = new Set(state.readyTerminals);
      readyTerminals.delete(terminalId);
      return { terminals, readyTerminals };
    });
  },

  setDrawerOpen: (projectId: string, open: boolean, backendId) => {
    const scopeKey = getTerminalScopeKey(projectId, backendId ?? useServerStore.getState().activeServerId);
    set((state) => ({ drawerOpen: { ...state.drawerOpen, [scopeKey]: open } }));
    // Sync terminal panel visibility in pluginStore
    usePluginStore.getState().updatePanelVisibility('terminal', open);
  },

  isDrawerOpen: (projectId: string, backendId) =>
    !!get().drawerOpen[getTerminalScopeKey(projectId, backendId ?? useServerStore.getState().activeServerId)],

  toggleCtrl: (terminalId: string) =>
    set((state) => ({ ctrlActive: { ...state.ctrlActive, [terminalId]: !state.ctrlActive[terminalId] } })),

  handleTerminalExited: (terminalId: string) => {
    // Remove the terminal mapping so next open creates a fresh one
    set((state) => {
      const terminals = { ...state.terminals };
      for (const [pid, tid] of Object.entries(terminals)) {
        if (tid === terminalId) {
          delete terminals[pid];
          break;
        }
      }
      const readyTerminals = new Set(state.readyTerminals);
      readyTerminals.delete(terminalId);
      return { terminals, readyTerminals };
    });
  },

  getTerminalId: (projectId: string, backendId) =>
    get().terminals[getTerminalScopeKey(projectId, backendId ?? useServerStore.getState().activeServerId)],

  markReady: (terminalId: string) => {
    const ready = get().readyTerminals;
    if (!ready.has(terminalId)) {
      const next = new Set(ready);
      next.add(terminalId);
      set({ readyTerminals: next });
    }
  },

  isReady: (terminalId: string) => {
    return get().readyTerminals.has(terminalId);
  },

  waitForReady: (terminalId: string, timeoutMs = 5000) => {
    if (get().readyTerminals.has(terminalId)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        unsub();
        resolve(false);
      }, timeoutMs);
      const unsub = useTerminalStore.subscribe((state) => {
        if (state.readyTerminals.has(terminalId)) {
          clearTimeout(timeout);
          unsub();
          resolve(true);
        }
      });
    });
  },

  addPoppedOutTerminal: (terminalId: string, windowLabel: string) => {
    set((state) => ({
      poppedOutTerminals: { ...state.poppedOutTerminals, [terminalId]: windowLabel },
    }));
  },

  removePoppedOutTerminal: (terminalId: string) => {
    set((state) => {
      const poppedOutTerminals = { ...state.poppedOutTerminals };
      delete poppedOutTerminals[terminalId];
      return { poppedOutTerminals };
    });
  },

  isTerminalPoppedOut: (terminalId: string) => {
    return !!get().poppedOutTerminals[terminalId];
  },
}));
