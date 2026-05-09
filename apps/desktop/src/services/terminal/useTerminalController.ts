/**
 * React hooks bridging TerminalRegistry / TerminalController to components.
 *
 * Phase 3 of the terminal subsystem refactor. Components don't yet use these —
 * the legacy XTerminal still goes through xtermRegistry + useEffect. Phase 5
 * rewrites XTerminal to consume these hooks.
 */

import { useMemo, useRef, useSyncExternalStore } from 'react';
import { terminalRegistry } from './TerminalRegistry';
import type { TerminalController, TerminalControllerDeps } from './TerminalController';
import type { TerminalLifecycleState } from './types';

/**
 * Read-only access: returns the existing controller (if any) and its current state.
 * Use this when the caller is confident some upstream code already created the controller.
 */
export function useTerminalController(terminalId: string | null): {
  controller: TerminalController | null;
  state: TerminalLifecycleState | null;
} {
  const controller = useMemo(
    () => (terminalId ? terminalRegistry.get(terminalId) ?? null : null),
    [terminalId],
  );

  const state = useSyncExternalStore(
    (cb) => controller?.subscribe(cb) ?? noopUnsubscribe,
    () => controller?.getState() ?? null,
    () => controller?.getState() ?? null,
  );

  return { controller, state };
}

/**
 * Get-or-create access: ensures a controller exists for `terminalId` and subscribes to it.
 *
 * `buildDeps` is called once per `terminalId` change. Captured via ref so callers can pass
 * inline arrow functions without forcing controller re-creation on every render — the
 * registry caches by `terminalId`, so the same id always returns the same controller.
 */
export function useEnsureTerminalController(
  terminalId: string,
  buildDeps: () => TerminalControllerDeps,
): { controller: TerminalController; state: TerminalLifecycleState } {
  const buildDepsRef = useRef(buildDeps);
  buildDepsRef.current = buildDeps;

  const controller = useMemo(
    () => terminalRegistry.getOrCreate(terminalId, buildDepsRef.current()),
    [terminalId],
  );

  const state = useSyncExternalStore(
    (cb) => controller.subscribe(cb),
    () => controller.getState(),
    () => controller.getState(),
  );

  return { controller, state };
}

const noopUnsubscribe = () => undefined;
