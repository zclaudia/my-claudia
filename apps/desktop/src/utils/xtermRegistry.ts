import type { Terminal } from '@xterm/xterm';
import type { FitAddon } from '@xterm/addon-fit';

interface TerminalEntry {
  terminal: Terminal;
  fitAddon: FitAddon;
  /** Whether terminal_open has been sent to the server for this terminal. */
  serverOpened: boolean;
}

/**
 * Simple registry for xterm.js Terminal instances.
 * Avoids storing non-serializable objects in Zustand.
 */
const instances = new Map<string, TerminalEntry>();

export const xtermRegistry = {
  set(terminalId: string, terminal: Terminal, fitAddon: FitAddon): void {
    instances.set(terminalId, { terminal, fitAddon, serverOpened: false });
  },

  get(terminalId: string): TerminalEntry | undefined {
    return instances.get(terminalId);
  },

  delete(terminalId: string): void {
    const entry = instances.get(terminalId);
    if (entry) {
      entry.terminal.dispose();
      instances.delete(terminalId);
    }
  },

  has(terminalId: string): boolean {
    return instances.has(terminalId);
  },
};
