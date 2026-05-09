import type {
  TerminalOpenMessage,
  TerminalInputMessage,
  TerminalResizeMessage,
  TerminalCloseMessage,
  TerminalDetachMessage,
  TerminalAttachMessage,
} from '@my-claudia/shared/protocol/messages';
import type { TerminalManager } from '../../../terminal-manager.js';
import type { ConnectedClient } from '../transport/types.js';
import { sendMessage } from '../transport/broadcast.js';
import type { initDatabase } from '../../../infrastructure/storage/db.js';

export function handleTerminalOpen(
  client: ConnectedClient,
  message: TerminalOpenMessage,
  db: ReturnType<typeof initDatabase>,
  termMgr: TerminalManager,
): void {
  const project = db.prepare('SELECT root_path FROM projects WHERE id = ?').get(message.projectId) as { root_path: string } | undefined;
  const cwd = message.workingDirectory || project?.root_path || process.env.HOME || '/';
  try {
    termMgr.create(message.terminalId, client.id, cwd, message.cols, message.rows);
    sendMessage(client.ws, { type: 'terminal_opened', terminalId: message.terminalId, success: true });
  } catch (err) {
    sendMessage(client.ws, {
      type: 'terminal_opened',
      terminalId: message.terminalId,
      success: false,
      error: err instanceof Error ? err.message : 'Failed to create terminal',
    });
  }
}

export function handleTerminalInput(message: TerminalInputMessage, termMgr: TerminalManager): void {
  termMgr.write(message.terminalId, message.data);
}

export function handleTerminalResize(message: TerminalResizeMessage, termMgr: TerminalManager): void {
  termMgr.resize(message.terminalId, message.cols, message.rows);
}

export function handleTerminalClose(
  client: ConnectedClient,
  message: TerminalCloseMessage,
  termMgr: TerminalManager,
): void {
  // Only the current owner may destroy the PTY. Without this check, a stale tab (e.g. the
  // main window after the user popped a terminal out) could yank the PTY out from under the
  // window that actually owns it.
  if (!termMgr.isOwnedBy(message.terminalId, client.id)) return;
  termMgr.destroy(message.terminalId);
}

export function handleTerminalDetach(message: TerminalDetachMessage, clientId: string, termMgr: TerminalManager): void {
  termMgr.detachTerminal(message.terminalId, clientId);
}

export function handleTerminalAttach(
  client: ConnectedClient,
  message: TerminalAttachMessage,
  termMgr: TerminalManager,
): void {
  const result = termMgr.attach(message.terminalId, client.id, message.cols, message.rows);
  sendMessage(client.ws, {
    type: 'terminal_attached',
    terminalId: message.terminalId,
    success: result.success,
    scrollback: result.scrollback,
    error: result.error,
    pendingExit: result.pendingExit,
  });
}
