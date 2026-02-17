import { useEffect, useRef } from 'react';

/**
 * Stack-based Android back handler.
 *
 * Multiple components can register back handlers with a priority.
 * When the Android back gesture fires, the highest-priority active handler runs.
 * If no handler is active, the event is ignored (app stays open).
 *
 * Priority guide (higher = runs first):
 *   30 — Settings content (back to tab list)
 *   20 — Settings / Agent panel (close overlay)
 *   10 — Sidebar drawer (close drawer)
 */

type BackHandler = () => void;
interface Registration {
  id: number;
  priority: number;
  handler: BackHandler;
}

let nextId = 0;
const registrations: Registration[] = [];

function dispatch() {
  if (registrations.length === 0) return;
  // Pick the highest-priority handler
  const top = registrations.reduce((a, b) => (a.priority >= b.priority ? a : b));
  top.handler();
}

// Listen once
if (typeof window !== 'undefined') {
  window.addEventListener('android-back', dispatch);
}

/**
 * Register a back handler while `enabled` is true.
 * When the Android back gesture fires, the highest-priority active handler runs.
 */
export function useAndroidBack(handler: BackHandler, enabled: boolean, priority: number) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    const id = nextId++;
    const reg: Registration = {
      id,
      priority,
      handler: () => handlerRef.current(),
    };
    registrations.push(reg);

    return () => {
      const idx = registrations.findIndex(r => r.id === id);
      if (idx !== -1) registrations.splice(idx, 1);
    };
  }, [enabled, priority]);
}
