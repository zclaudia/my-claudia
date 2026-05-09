/**
 * TerminalRegistry — per-window collection of TerminalController instances.
 *
 * Phase 3 of the terminal subsystem refactor. Replaces the role of the legacy
 * `xtermRegistry` (which only stored xterm Terminal/FitAddon pairs and a mutable
 * `serverOpened` flag) with a single owner that knows about the full lifecycle
 * via TerminalController.
 *
 * Each Tauri webview has its own JS context and therefore its own registry —
 * the main window and a popped-out window do NOT share controller instances.
 * That is intentional: the same `terminalId` corresponds to one server-side PTY
 * but two distinct view-side controllers, only one of which holds ownership at
 * any moment (enforced by `terminal_attach`).
 */

import type { ServerMessage } from '@my-claudia/shared';
import { TerminalController, type TerminalControllerDeps } from './TerminalController';

class TerminalRegistryImpl {
  private readonly controllers = new Map<string, TerminalController>();

  /** Returns the existing controller for `terminalId`, or creates one with `deps`. */
  getOrCreate(terminalId: string, deps: TerminalControllerDeps): TerminalController {
    const existing = this.controllers.get(terminalId);
    if (existing) return existing;
    const controller = new TerminalController(deps);
    this.controllers.set(terminalId, controller);
    return controller;
  }

  get(terminalId: string): TerminalController | undefined {
    return this.controllers.get(terminalId);
  }

  has(terminalId: string): boolean {
    return this.controllers.has(terminalId);
  }

  /** Disposes the controller and removes it from the registry. Idempotent. */
  delete(terminalId: string): void {
    const controller = this.controllers.get(terminalId);
    if (!controller) return;
    controller.dispose();
    this.controllers.delete(terminalId);
  }

  /** Iterate every live controller — used by ws-reconnect / backend-offline flows. */
  forEach(fn: (controller: TerminalController, terminalId: string) => void): void {
    for (const [id, controller] of this.controllers) fn(controller, id);
  }

  /**
   * Route an inbound server message to the matching controller. Returns true if a
   * controller consumed it. Caller decides whether to fall through to legacy handlers
   * (during the migration window) or treat unmatched messages as orphan / log them.
   */
  dispatchServerMessage(msg: ServerMessage): boolean {
    const terminalId = (msg as { terminalId?: string }).terminalId;
    if (!terminalId) return false;
    const controller = this.controllers.get(terminalId);
    if (!controller) return false;
    controller.handleServerMessage(msg);
    return true;
  }

  /** Tear down every controller. Used by app-shutdown paths and tests. */
  clear(): void {
    for (const controller of this.controllers.values()) controller.dispose();
    this.controllers.clear();
  }

  /** Test helper. */
  size(): number {
    return this.controllers.size;
  }
}

export type TerminalRegistry = TerminalRegistryImpl;

/** Default per-window singleton. Apps consume this; tests can build their own instance. */
export const terminalRegistry: TerminalRegistry = new TerminalRegistryImpl();

/** Factory for tests that need full isolation from the singleton. */
export function createTerminalRegistry(): TerminalRegistry {
  return new TerminalRegistryImpl();
}
