/**
 * Window Router — detects URL params to render standalone windows
 * (file viewer, automation, workflow editor, session chat, terminal,
 * draft editor, claudia ball/chat, notch, plugin).
 * Falls through to the main AppContent if no standalone param is found.
 */
import type { ReactNode } from 'react';
import { WindowShell } from './windows/WindowShell';
import { resolveStandaloneWindowRoute } from './windows/windowRoutes';

/** Main entry component — passed as children when no standalone window is detected. */
export function WindowRouter({ children }: { children: ReactNode }) {
  const params = new URLSearchParams(window.location.search);
  const standaloneRoute = resolveStandaloneWindowRoute(params);
  if (standaloneRoute) return standaloneRoute.element;

  // Default: main app
  return (
    <WindowShell label="App" connection>
      {children}
    </WindowShell>
  );
}
