/**
 * TerminalController — single source of truth for one terminal's lifecycle.
 *
 * Owns the xterm.js instance, the PTY protocol state machine, the DOM mount,
 * and every disposable (onData handler, ResizeObserver) so that no one outside
 * the controller can leave them in an inconsistent state.
 *
 * Created in phase 2 of the terminal refactor; not yet wired into React views.
 */

import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import type { ClientMessage, ServerMessage } from '@my-claudia/shared';
import {
  type DetachReason,
  type TerminalLifecycleState,
  type TerminalLifecycleKind,
  canTransition,
} from './types';

export interface TerminalControllerDeps {
  terminalId: string;
  sendMessage: (msg: ClientMessage) => void;
  /** Called on demand whenever the controller needs a fresh ITheme (open/refreshTheme). */
  getTheme: () => ITheme;
  /**
   * Optional override hook for tests — replaces the default xterm Terminal/FitAddon constructors
   * so tests can inject mock implementations without `vi.mock`-ing the entire module.
   */
  factories?: {
    createTerminal?: (theme: ITheme) => Terminal;
    createFitAddon?: () => FitAddon;
  };
  /**
   * Optional logger. Production should pass a real logger; tests typically pass nothing
   * (illegal-transition warnings stay silent in tests).
   */
  logger?: { warn: (msg: string) => void };
}

export interface TerminalOpenOptions {
  projectId: string;
  workingDirectory?: string;
  cols?: number;
  rows?: number;
}

export interface TerminalAttachOptions {
  cols?: number;
  rows?: number;
}

type Listener = (state: TerminalLifecycleState) => void;

const DEFAULT_COLS = 80;
const DEFAULT_ROWS = 24;

export class TerminalController {
  private state: TerminalLifecycleState = { kind: 'idle' };
  private readonly listeners = new Set<Listener>();
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private boundContainer: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private dataDisposable: { dispose: () => void } | null = null;

  constructor(private readonly deps: TerminalControllerDeps) {}

  // ---- public observers ----

  getState(): TerminalLifecycleState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Test helper — exposes current pty grid size; defaults if no xterm yet. */
  getDimensions(): { cols: number; rows: number } {
    return {
      cols: this.terminal?.cols ?? DEFAULT_COLS,
      rows: this.terminal?.rows ?? DEFAULT_ROWS,
    };
  }

  // ---- lifecycle actions ----

  /** Send terminal_open and move into the `opening` state. */
  open(opts: TerminalOpenOptions): void {
    if (!this.guardTransition('opening')) return;
    this.ensureTerminal();
    this.bindOnDataOnce();
    this.remountIfBound();
    const cols = opts.cols ?? this.terminal!.cols;
    const rows = opts.rows ?? this.terminal!.rows;
    this.transition({ kind: 'opening' });
    this.deps.sendMessage({
      type: 'terminal_open',
      terminalId: this.deps.terminalId,
      projectId: opts.projectId,
      workingDirectory: opts.workingDirectory,
      cols,
      rows,
    });
  }

  /** Send terminal_attach (first attach or after a detach) and move into `attaching`. */
  attach(opts: TerminalAttachOptions = {}): void {
    if (!this.guardTransition('attaching')) return;
    this.ensureTerminal();
    this.bindOnDataOnce();
    this.remountIfBound();
    const cols = opts.cols ?? this.terminal!.cols;
    const rows = opts.rows ?? this.terminal!.rows;
    this.transition({ kind: 'attaching' });
    this.deps.sendMessage({
      type: 'terminal_attach',
      terminalId: this.deps.terminalId,
      cols,
      rows,
    });
  }

  /**
   * Voluntarily release ownership of the PTY without disposing the xterm instance.
   * Used by backend-offline and ws-reconnect paths where the same view will reattach soon.
   */
  detach(reason: DetachReason): void {
    if (this.state.kind !== 'open') return;
    this.transition({ kind: 'detached', reason });
    this.deps.sendMessage({
      type: 'terminal_detach',
      terminalId: this.deps.terminalId,
    });
  }

  /**
   * Pop-out path: dispose this view's xterm but keep the bound container reference so a later
   * claim() can remount into the same DOM node. Tell the server we no longer want output —
   * the PTY keeps running on the server so another window (or this one via claim()) can reattach.
   */
  release(): void {
    const wasOpen = this.state.kind === 'open';
    const keepContainer = this.boundContainer;
    this.disposeXterm();
    this.boundContainer = keepContainer;
    if (wasOpen) {
      this.transition({ kind: 'detached', reason: 'popout' });
      this.deps.sendMessage({
        type: 'terminal_detach',
        terminalId: this.deps.terminalId,
      });
    }
  }

  /** Pop-in path: reattach to the still-alive PTY (rebuilds xterm via attach()). */
  claim(opts: TerminalAttachOptions = {}): void {
    this.attach(opts);
  }

  /**
   * Tell the server to destroy the PTY and dispose locally.
   * After `close()` the controller transitions to `disposed` and should be removed from the registry.
   */
  close(): void {
    this.deps.sendMessage({
      type: 'terminal_close',
      terminalId: this.deps.terminalId,
    });
    this.dispose();
  }

  /** Front-end-only cleanup — does not send terminal_close. Safe to call repeatedly. */
  dispose(): void {
    if (this.state.kind === 'disposed') return;
    this.disposeXterm();
    this.transition({ kind: 'disposed' });
    this.listeners.clear();
  }

  // ---- view binding ----

  /**
   * Mount the xterm into the given container. Returns an unbind function that detaches the
   * ResizeObserver but leaves the xterm instance and PTY untouched.
   */
  bindView(container: HTMLElement): () => void {
    if (this.state.kind === 'disposed') return () => undefined;
    this.boundContainer = container;
    this.ensureTerminal();
    this.attachToDOM(container);
    this.observeResize(container);
    return () => {
      if (this.boundContainer === container) {
        this.unbindContainer();
      }
    };
  }

  /** Re-applies the current theme — call this from a theme-context effect. */
  refreshTheme(): void {
    if (this.terminal) {
      this.terminal.options.theme = this.deps.getTheme();
    }
  }

  /** Focuses the underlying xterm if mounted; safe to call even if not yet rendered. */
  focus(): void {
    try {
      this.terminal?.focus();
    } catch {
      // Mobile WebViews occasionally throw on focus before the canvas is ready.
    }
  }

  // ---- inbound server messages ----

  handleServerMessage(msg: ServerMessage): void {
    switch (msg.type) {
      case 'terminal_opened': {
        if (msg.terminalId !== this.deps.terminalId) return;
        if (this.state.kind !== 'opening') return;
        if (msg.success) {
          this.transition({ kind: 'open' });
        } else {
          this.transition({ kind: 'failed', error: msg.error ?? 'Failed to open terminal' });
        }
        return;
      }
      case 'terminal_attached': {
        if (msg.terminalId !== this.deps.terminalId) return;
        if (this.state.kind !== 'attaching') return;
        if (msg.success) {
          if (msg.scrollback && this.terminal) {
            for (const chunk of msg.scrollback) this.terminal.write(chunk);
          }
          this.transition({ kind: 'open' });
        } else {
          this.transition({ kind: 'failed', error: msg.error ?? 'Failed to attach terminal' });
        }
        return;
      }
      case 'terminal_output': {
        if (msg.terminalId !== this.deps.terminalId) return;
        // Output may arrive briefly while still in `attaching` (server flushes before our state
        // updates) — write it through anyway. If we are already disposed, the xterm is gone.
        this.terminal?.write(msg.data);
        return;
      }
      case 'terminal_exited': {
        if (msg.terminalId !== this.deps.terminalId) return;
        this.terminal?.write(`\r\n[Process exited with code ${msg.exitCode}]\r\n`);
        if (canTransition(this.state.kind, 'exited')) {
          this.transition({ kind: 'exited', code: msg.exitCode });
        }
        return;
      }
      default:
        return;
    }
  }

  // ---- internals ----

  private ensureTerminal(): void {
    if (this.terminal) return;
    const theme = this.deps.getTheme();
    this.terminal = this.deps.factories?.createTerminal
      ? this.deps.factories.createTerminal(theme)
      : new Terminal({
          cursorBlink: true,
          fontSize: 14,
          fontFamily: 'Menlo, Monaco, "Courier New", monospace',
          theme,
          allowProposedApi: true,
        });
    this.fitAddon = this.deps.factories?.createFitAddon
      ? this.deps.factories.createFitAddon()
      : new FitAddon();
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(new WebLinksAddon());
  }

  /**
   * Wires onData → terminal_input exactly once per xterm instance.
   * Re-entry (e.g. effect re-runs after state changes) is a no-op, fixing the historical
   * "every keystroke is sent N times" regression.
   */
  private bindOnDataOnce(): void {
    if (this.dataDisposable || !this.terminal) return;
    this.dataDisposable = this.terminal.onData((data) => {
      this.deps.sendMessage({
        type: 'terminal_input',
        terminalId: this.deps.terminalId,
        data,
      });
    });
  }

  /**
   * Re-mount the (possibly freshly created) xterm into the previously bound container, if any.
   * Lets release() + claim() keep the same DOM node without forcing the React layer to re-bind.
   */
  private remountIfBound(): void {
    const container = this.boundContainer;
    if (!container) return;
    this.attachToDOM(container);
    this.observeResize(container);
  }

  private attachToDOM(container: HTMLElement): void {
    if (!this.terminal) return;
    const termElement = (this.terminal as unknown as { element?: HTMLElement }).element;
    if (termElement) {
      if (termElement.parentElement !== container) container.appendChild(termElement);
    } else {
      if (container.firstChild) container.replaceChildren();
      this.terminal.open(container);
    }
    if (container.clientHeight > 0 && container.clientWidth > 0) {
      this.fitAddon?.fit();
    }
  }

  private observeResize(container: HTMLElement): void {
    this.resizeObserver?.disconnect();
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver(() => {
      if (!container || container.clientHeight === 0 || container.clientWidth === 0) return;
      this.fitAddon?.fit();
      if (this.state.kind === 'open' && this.terminal) {
        this.deps.sendMessage({
          type: 'terminal_resize',
          terminalId: this.deps.terminalId,
          cols: this.terminal.cols,
          rows: this.terminal.rows,
        });
      }
    });
    this.resizeObserver.observe(container);
  }

  private unbindContainer(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.boundContainer = null;
  }

  private disposeXterm(): void {
    this.dataDisposable?.dispose();
    this.dataDisposable = null;
    this.unbindContainer();
    if (this.terminal) {
      try {
        this.terminal.dispose();
      } catch {
        // xterm may throw during dispose if already torn down — safe to ignore.
      }
    }
    this.terminal = null;
    this.fitAddon = null;
  }

  private guardTransition(next: TerminalLifecycleKind): boolean {
    if (canTransition(this.state.kind, next)) return true;
    this.deps.logger?.warn(
      `[TerminalController:${this.deps.terminalId}] illegal transition ${this.state.kind} -> ${next}`,
    );
    return false;
  }

  private transition(next: TerminalLifecycleState): void {
    this.state = next;
    for (const listener of this.listeners) listener(next);
  }
}
