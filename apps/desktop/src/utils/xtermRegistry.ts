import type { Terminal } from '@xterm/xterm';

/**
 * Simple registry for xterm.js Terminal instances.
 * Avoids storing non-serializable objects in Zustand.
 */
const instances = new Map<string, Terminal>();

export const xtermRegistry = {
  set(terminalId: string, terminal: Terminal): void {
    instances.set(terminalId, terminal);
  },

  get(terminalId: string): Terminal | undefined {
    return instances.get(terminalId);
  },

  delete(terminalId: string): void {
    const terminal = instances.get(terminalId);
    if (terminal) {
      terminal.dispose();
      instances.delete(terminalId);
    }
  },

  has(terminalId: string): boolean {
    return instances.has(terminalId);
  },
};
