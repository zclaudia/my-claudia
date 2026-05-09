/**
 * Terminal I/O message handlers.
 *
 * Migration note: messages are also dispatched to the new TerminalRegistry first.
 * If a TerminalController consumed it, the legacy xtermRegistry path below becomes a no-op
 * (legacy registry has no entry for ids owned by the new controller). The two paths coexist
 * during the refactor and both fall away once phase 7 deletes the legacy registry.
 */
import type { ServerMessage } from '@my-claudia/shared';
import { useTerminalStore } from '../../stores/terminalStore';
import { xtermRegistry } from '../../utils/xtermRegistry';
import { terminalRegistry } from '../terminal/TerminalRegistry';

export function handleTerminalMessage(msg: ServerMessage, logTag: string): boolean {
  // Phase 4 — try the new registry first; if it owns the terminalId, the controller
  // performs the full update (xterm.write, state machine, scrollback) and the legacy path
  // below safely no-ops.
  terminalRegistry.dispatchServerMessage(msg);

  switch (msg.type) {
    case 'terminal_opened': {
      if (!msg.success) {
        console.error(`[${logTag}] Terminal open failed:`, msg.error);
        const entry = xtermRegistry.get(msg.terminalId);
        if (entry) {
          entry.terminal.writeln(`\r\n\x1b[31mTerminal failed to open: ${msg.error || 'Unknown error'}\x1b[0m`);
        }
      }
      return true;
    }

    case 'terminal_attached': {
      const attachEntry = xtermRegistry.get(msg.terminalId);
      if (attachEntry) {
        if (msg.success && msg.scrollback) {
          for (const chunk of msg.scrollback) {
            attachEntry.terminal.write(chunk);
          }
        } else if (!msg.success) {
          attachEntry.terminal.writeln(`\r\n\x1b[31mTerminal attach failed: ${msg.error || 'Unknown error'}\x1b[0m`);
        }
      }
      if (msg.success) {
        useTerminalStore.getState().clearReattachFailed(msg.terminalId);
        useTerminalStore.getState().clearNeedsReattach(msg.terminalId);
        useTerminalStore.getState().markReady(msg.terminalId);
      } else if (msg.error === 'Terminal not found') {
        useTerminalStore.getState().markReattachFailed(msg.terminalId);
      }
      return true;
    }

    case 'terminal_output': {
      const entry = xtermRegistry.get(msg.terminalId);
      if (entry) {
        entry.terminal.write(msg.data);
        useTerminalStore.getState().markReady(msg.terminalId);
      }
      return true;
    }

    case 'terminal_exited': {
      const exitTerm = xtermRegistry.get(msg.terminalId)?.terminal;
      if (exitTerm) exitTerm.write(`\r\n[Process exited with code ${msg.exitCode}]\r\n`);
      useTerminalStore.getState().handleTerminalExited(msg.terminalId);
      xtermRegistry.delete(msg.terminalId);
      return true;
    }

    default:
      return false;
  }
}
