/**
 * Terminal I/O message handlers.
 *
 * Post-refactor: every terminal-* message is dispatched into TerminalRegistry; the matching
 * TerminalController owns xterm.write, the lifecycle state machine, scrollback flush,
 * and store mapping cleanup on exit. This handler only logs failed open attempts and tells
 * the dispatcher whether the message was a terminal_* one (so unrelated logs aren't double-counted).
 */
import type { ServerMessage } from '@my-claudia/shared';
import { useTerminalStore } from '../../stores/terminalStore';
import { terminalRegistry } from '../terminal/TerminalRegistry';

const TERMINAL_MESSAGE_TYPES = new Set<ServerMessage['type']>([
  'terminal_opened',
  'terminal_attached',
  'terminal_output',
  'terminal_exited',
]);

export function handleTerminalMessage(msg: ServerMessage, logTag: string): boolean {
  if (!TERMINAL_MESSAGE_TYPES.has(msg.type)) return false;

  terminalRegistry.dispatchServerMessage(msg);

  if (msg.type === 'terminal_opened' && !msg.success) {
    console.error(`[${logTag}] Terminal open failed:`, msg.error);
  }

  if (msg.type === 'terminal_exited') {
    // Drop the project → terminalId mapping so the next open creates a fresh PTY.
    useTerminalStore.getState().handleTerminalExited(msg.terminalId);
  }

  return true;
}
