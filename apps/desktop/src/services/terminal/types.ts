/**
 * Lifecycle types for the terminal subsystem refactor.
 *
 * This file is the contract shared between the future TerminalController, the React views,
 * and the message-handler / store layers. It introduces no runtime behavior on its own —
 * the existing code paths continue to work unchanged until subsequent refactor phases wire
 * these types in.
 *
 * Naming convention follows the discriminated-union style used elsewhere in the codebase
 * (`ContentBlock`, `InteractionMessage`, etc.) so destructuring and exhaustive switches
 * keep readability consistent.
 */

/**
 * Why a terminal handed off ownership of its PTY to "no one" (server-side `clientId = null`).
 *
 * - `popout`            — user dragged the panel into a standalone Tauri window. The main-window
 *                         instance should self-dispose; the new window claims ownership.
 * - `backend_offline`   — the backend facade emitted offline / error. The PTY may or may not still
 *                         exist on the server; reattach when the backend comes back.
 * - `ws_reconnect`      — the WebSocket transport bounced (no offline event, just a fresh `client.id`).
 *                         A reattach is needed to refresh ownership; the user should ideally
 *                         not notice anything.
 */
export type DetachReason = 'popout' | 'backend_offline' | 'ws_reconnect';

/**
 * Discriminated union covering every observable state of a single terminal in the client.
 *
 * Designed so that:
 *   • `kind` alone is enough for UI to choose what to render (loading, terminal, error banner, …)
 *   • Payload data only lives on states that need it (e.g. exit code on `exited`)
 *   • Adding a new state forces every `switch` to handle it (TS exhaustiveness)
 *
 * Transitions are documented in {@link TERMINAL_LIFECYCLE_TRANSITIONS} below.
 */
export type TerminalLifecycleState =
  /** Newly created controller; nothing requested from the server yet. */
  | { kind: 'idle' }
  /** `terminal_open` sent, awaiting `terminal_opened`. */
  | { kind: 'opening' }
  /** `terminal_attach` sent (first time or after detach), awaiting `terminal_attached`. */
  | { kind: 'attaching' }
  /** PTY exists and this client currently owns it (receives output, sends input). */
  | { kind: 'open' }
  /** PTY presumed alive on the server but this client released ownership; ready to reattach. */
  | { kind: 'detached'; reason: DetachReason }
  /** Last open/attach attempt failed (PTY not found, spawn error, etc.). User-driven retry possible. */
  | { kind: 'failed'; error: string }
  /** PTY exited (normal `exit` or signal). Terminal view shows an exit banner. */
  | { kind: 'exited'; code: number }
  /** Final state — xterm instance + DOM disposed. Controller should be removed from the registry. */
  | { kind: 'disposed' };

/** Convenience: just the `kind` discriminator. */
export type TerminalLifecycleKind = TerminalLifecycleState['kind'];

/**
 * Allowed transitions per source state. A trigger that is not listed here is a programmer error
 * and the controller will throw rather than silently mutate.
 *
 * Triggers are intentionally named after the controller actions and the inbound server messages,
 * not after low-level details, so the table reads as a behavior contract.
 *
 *   ┌──────────────┐                                                ┌──────────────┐
 *   │     idle     │ ──── open() ──────────────────────────────────►│   opening    │
 *   │              │ ──── attach() ────────────────────────────────►│  attaching   │
 *   │              │ ──── dispose() ───────────────────────────────►│   disposed   │
 *   └──────────────┘                                                └──────┬───────┘
 *                                                                          │
 *                              terminal_opened(success)/                   │
 *                              terminal_attached(success)                  │
 *                                                                          ▼
 *                                                                   ┌──────────┐
 *                                                                   │   open   │
 *                                                                   └────┬─────┘
 *                                                                        │
 *                                          detach(reason) ──────────────►├─────► detached
 *                                          terminal_exited(code) ───────►├─────► exited
 *                                          dispose() ────────────────────└─────► disposed
 *
 *   detached ── reattach() ───────────► attaching ── (success/error) ─► open / failed
 *   detached ── dispose() ────────────► disposed
 *
 *   failed   ── open() / attach() ────► opening / attaching   (user retry)
 *   failed   ── dispose() ────────────► disposed
 *
 *   exited / disposed are terminal — only `disposed` is reachable from `exited`
 *   (via the controller's automatic cleanup or explicit dispose()).
 */
export const TERMINAL_LIFECYCLE_TRANSITIONS: Readonly<Record<TerminalLifecycleKind, readonly TerminalLifecycleKind[]>> = Object.freeze({
  idle:       ['opening', 'attaching', 'disposed'],
  opening:    ['open', 'failed', 'disposed'],
  attaching:  ['open', 'failed', 'disposed'],
  open:       ['detached', 'exited', 'disposed'],
  detached:   ['attaching', 'disposed'],
  failed:     ['opening', 'attaching', 'disposed'],
  exited:     ['disposed'],
  disposed:   [],
});

/** Returns true iff `next` is a legal successor of `current`. */
export function canTransition(
  current: TerminalLifecycleKind,
  next: TerminalLifecycleKind,
): boolean {
  return TERMINAL_LIFECYCLE_TRANSITIONS[current].includes(next);
}

/** Convenience predicates used across views and tests. */
export const isTerminalReady = (s: TerminalLifecycleState): boolean => s.kind === 'open';
export const isTerminalBusy = (s: TerminalLifecycleState): boolean => s.kind === 'opening' || s.kind === 'attaching';
export const isTerminalTerminal = (s: TerminalLifecycleState): boolean => s.kind === 'exited' || s.kind === 'disposed';
