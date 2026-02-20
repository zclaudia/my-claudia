import { create } from 'zustand';

interface TerminalState {
  // Active terminal per project (projectId → terminalId)
  terminals: Record<string, string>;
  // Terminals that have received first output (shell prompt ready)
  readyTerminals: Set<string>;
  // Drawer open state per project (projectId → boolean)
  drawerOpen: Record<string, boolean>;
  // Sticky Ctrl key per terminal (auto-disables after one keystroke)
  ctrlActive: Record<string, boolean>;

  openTerminal: (projectId: string) => string;
  closeTerminal: (terminalId: string) => void;
  setDrawerOpen: (projectId: string, open: boolean) => void;
  isDrawerOpen: (projectId: string) => boolean;
  toggleCtrl: (terminalId: string) => void;
  handleTerminalExited: (terminalId: string) => void;
  getTerminalId: (projectId: string) => string | undefined;
  markReady: (terminalId: string) => void;
  isReady: (terminalId: string) => boolean;
  /** Returns a promise that resolves when the terminal is ready (shell loaded). */
  waitForReady: (terminalId: string, timeoutMs?: number) => Promise<boolean>;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  terminals: {},
  readyTerminals: new Set<string>(),
  drawerOpen: {},
  ctrlActive: {},

  openTerminal: (projectId: string) => {
    const existing = get().terminals[projectId];
    if (existing) return existing;
    const terminalId = crypto.randomUUID();
    set((state) => ({
      terminals: { ...state.terminals, [projectId]: terminalId },
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

  setDrawerOpen: (projectId: string, open: boolean) =>
    set((state) => ({ drawerOpen: { ...state.drawerOpen, [projectId]: open } })),

  isDrawerOpen: (projectId: string) => !!get().drawerOpen[projectId],

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

  getTerminalId: (projectId: string) => {
    return get().terminals[projectId];
  },

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
}));
