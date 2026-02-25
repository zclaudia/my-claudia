import * as pty from 'node-pty';
import { execSync } from 'child_process';
import type { TerminalOutputMessage, TerminalExitedMessage, ServerMessage } from '@my-claudia/shared';

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Detect available shell for the current platform.
 *
 * - Linux / macOS: use $SHELL or fallback to 'bash'
 * - Windows: prefer WSL ('wsl.exe') if installed, otherwise 'powershell.exe'
 */
function detectShell(): string {
  if (process.platform !== 'win32') {
    return process.env.SHELL || 'bash';
  }

  // Windows: check if WSL is available
  try {
    execSync('wsl.exe --status', {
      timeout: 3000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return 'wsl.exe';
  } catch {
    // WSL not available, fall back to PowerShell
    return process.env.COMSPEC || 'powershell.exe';
  }
}

interface ManagedTerminal {
  pty: pty.IPty;
  clientId: string;
  projectId: string;
  lastActivity: number;
  idleTimer: ReturnType<typeof setTimeout>;
}

export class TerminalManager {
  private terminals = new Map<string, ManagedTerminal>();
  private sendToClient: (clientId: string, msg: ServerMessage) => void;

  constructor(sendToClient: (clientId: string, msg: ServerMessage) => void) {
    this.sendToClient = sendToClient;
  }

  create(terminalId: string, clientId: string, cwd: string, cols: number, rows: number): void {
    // Destroy existing terminal with same ID if any
    if (this.terminals.has(terminalId)) {
      this.destroy(terminalId);
    }

    const shell = detectShell();
    console.log(`[Terminal] Spawning: shell=${shell}, cwd=${cwd}, cols=${cols}, rows=${rows}`);
    let ptyProcess: pty.IPty;
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd,
        env: process.env as Record<string, string>,
      });
    } catch (err) {
      console.error(`[Terminal] pty.spawn failed: shell=${shell}, cwd=${cwd}, PATH=${process.env.PATH?.substring(0, 200)}`);
      throw err;
    }

    const managed: ManagedTerminal = {
      pty: ptyProcess,
      clientId,
      projectId: '',
      lastActivity: Date.now(),
      idleTimer: this.startIdleTimer(terminalId),
    };

    this.terminals.set(terminalId, managed);

    ptyProcess.onData((data) => {
      this.sendToClient(clientId, {
        type: 'terminal_output',
        terminalId,
        data,
      } as TerminalOutputMessage);
    });

    ptyProcess.onExit(({ exitCode }) => {
      this.sendToClient(clientId, {
        type: 'terminal_exited',
        terminalId,
        exitCode,
      } as TerminalExitedMessage);
      this.terminals.delete(terminalId);
      clearTimeout(managed.idleTimer);
    });
  }

  write(terminalId: string, data: string): void {
    const managed = this.terminals.get(terminalId);
    if (!managed) return;
    managed.lastActivity = Date.now();
    this.resetIdleTimer(terminalId, managed);
    managed.pty.write(data);
  }

  resize(terminalId: string, cols: number, rows: number): void {
    const managed = this.terminals.get(terminalId);
    if (!managed) return;
    managed.pty.resize(cols, rows);
  }

  destroy(terminalId: string): void {
    const managed = this.terminals.get(terminalId);
    if (!managed) return;
    clearTimeout(managed.idleTimer);
    managed.pty.kill();
    this.terminals.delete(terminalId);
  }

  destroyForClient(clientId: string): void {
    for (const [terminalId, managed] of this.terminals) {
      if (managed.clientId === clientId) {
        clearTimeout(managed.idleTimer);
        managed.pty.kill();
        this.terminals.delete(terminalId);
      }
    }
  }

  destroyAll(): void {
    for (const [, managed] of this.terminals) {
      clearTimeout(managed.idleTimer);
      managed.pty.kill();
    }
    this.terminals.clear();
  }

  private startIdleTimer(terminalId: string): ReturnType<typeof setTimeout> {
    return setTimeout(() => {
      console.log(`[Terminal] Idle timeout for terminal ${terminalId}`);
      this.destroy(terminalId);
    }, IDLE_TIMEOUT_MS);
  }

  private resetIdleTimer(terminalId: string, managed: ManagedTerminal): void {
    clearTimeout(managed.idleTimer);
    managed.idleTimer = this.startIdleTimer(terminalId);
  }
}
