/**
 * Remote terminal messages: open, input, resize, close, attach, detach (Client -> Server)
 * and opened, output, exited, attached (Server -> Client).
 */

// Client → Server

export interface TerminalOpenMessage {
  type: 'terminal_open';
  terminalId: string;
  projectId: string;
  workingDirectory?: string;
  cols: number;
  rows: number;
}

export interface TerminalInputMessage {
  type: 'terminal_input';
  terminalId: string;
  data: string;
}

export interface TerminalResizeMessage {
  type: 'terminal_resize';
  terminalId: string;
  cols: number;
  rows: number;
}

export interface TerminalCloseMessage {
  type: 'terminal_close';
  terminalId: string;
}

export interface TerminalAttachMessage {
  type: 'terminal_attach';
  terminalId: string;
  cols: number;
  rows: number;
}

export interface TerminalDetachMessage {
  type: 'terminal_detach';
  terminalId: string;
}

// Server → Client

export interface TerminalOpenedMessage {
  type: 'terminal_opened';
  terminalId: string;
  success: boolean;
  error?: string;
}

export interface TerminalOutputMessage {
  type: 'terminal_output';
  terminalId: string;
  data: string;
}

export interface TerminalExitedMessage {
  type: 'terminal_exited';
  terminalId: string;
  exitCode: number;
}

export interface TerminalAttachedMessage {
  type: 'terminal_attached';
  terminalId: string;
  success: boolean;
  scrollback?: string[];
  error?: string;
  /**
   * Set when the PTY exited while detached (no clientId to deliver `terminal_exited` to).
   * The reattaching client gets the scrollback and the exit code in one round-trip and
   * should transition to its `exited` state right after writing the scrollback.
   */
  pendingExit?: { exitCode: number };
}
