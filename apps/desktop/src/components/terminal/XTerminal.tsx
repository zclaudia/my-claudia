import { useEffect, useRef, useCallback } from 'react';
import type { ITheme } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import type { ClientMessage } from '@my-claudia/shared';
import { useConnection } from '../../contexts/ConnectionContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useEnsureTerminalController } from '../../services/terminal/useTerminalController';
import { useTerminalStore } from '../../stores/terminalStore';
import { useServerStore } from '../../stores/serverStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { isMobileBackendUsable } from '../../services/mobileConnectionState';

/** Convert CSS HSL string "H S% L%" to hex "#rrggbb" */
function hslToHex(hsl: string): string {
  const parts = hsl.split(/\s+/);
  if (parts.length < 3) return '#000000';
  const h = parseFloat(parts[0]) / 360;
  const s = parseFloat(parts[1]) / 100;
  const l = parseFloat(parts[2]) / 100;

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (c: number) =>
    Math.round(c * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function getTerminalTheme(): ITheme {
  const style = getComputedStyle(document.documentElement);
  const get = (v: string) => hslToHex(style.getPropertyValue(v).trim());
  return {
    background: get('--terminal-bg'),
    foreground: get('--terminal-fg'),
    cursor: get('--terminal-cursor'),
    selectionBackground: get('--terminal-selection'),
  };
}

interface XTerminalProps {
  terminalId: string;
  projectId: string;
  workingDirectory?: string;
  /** 'open' creates a new PTY, 'attach' reconnects to an existing one */
  mode?: 'open' | 'attach';
}

export function XTerminal({ terminalId, projectId, workingDirectory, mode = 'open' }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { sendMessage, connectServer } = useConnection();
  const { resolvedTheme } = useTheme();

  const activeServerId = useServerStore((s) => s.activeServerId);
  const facadeConnectionState = useFacadeStore((s) => s.connectionState);
  const facadeBackends = useFacadeStore((s) => s.backends);

  // sendMessage / connectServer are captured by the controller for its full lifetime.
  // Wrap them in refs so the references seen by the controller stay valid even when the
  // ConnectionContext rebuilds them.
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const connectServerRef = useRef(connectServer);
  connectServerRef.current = connectServer;

  /**
   * Wrap outgoing terminal_input with the sticky-Ctrl transform used on mobile, so the controller
   * can keep its onData binding generic. Other message types pass through untouched.
   */
  const wrappedSend = useCallback((msg: ClientMessage) => {
    if (msg.type === 'terminal_input' && msg.terminalId === terminalId) {
      const store = useTerminalStore.getState();
      if (store.ctrlActive[terminalId] && msg.data.length === 1) {
        const code = msg.data.charCodeAt(0);
        let data = msg.data;
        if (code >= 97 && code <= 122) data = String.fromCharCode(code - 96);
        else if (code >= 65 && code <= 90) data = String.fromCharCode(code - 64);
        store.toggleCtrl(terminalId);
        sendMessageRef.current({ ...msg, data });
        return;
      }
    }
    sendMessageRef.current(msg);
  }, [terminalId]);

  const buildDeps = useCallback(
    () => ({
      terminalId,
      sendMessage: wrappedSend,
      getTheme: getTerminalTheme,
    }),
    [terminalId, wrappedSend],
  );

  const { controller, state } = useEnsureTerminalController(terminalId, buildDeps);

  // Theme refresh — small debounce avoids flashing during cross-fade transitions
  useEffect(() => {
    const t = setTimeout(() => controller.refreshTheme(), 50);
    return () => clearTimeout(t);
  }, [controller, resolvedTheme]);

  // Mount the xterm into the container; auto-detach on unmount
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    return controller.bindView(container);
  }, [controller]);

  /**
   * Drive the lifecycle:
   *   idle              → open() or attach() based on `mode`
   *   detached          → reattach automatically (e.g. ws bounce)
   *   failed (mode=attach, first time) → fall back to open()
   * Other states are mid-flight; the controller is already on it.
   */
  const fallbackUsedRef = useRef(false);
  useEffect(() => {
    fallbackUsedRef.current = false;
  }, [mode, terminalId]);

  useEffect(() => {
    if (state.kind === 'idle') {
      if (mode === 'attach') {
        controller.attach();
      } else {
        // Match legacy connectServer side-effect when the backend transport is dropped.
        const reachable = isMobileBackendUsable({
          backendId: activeServerId,
          connectionState: facadeConnectionState,
          backends: facadeBackends,
        });
        if (!reachable && activeServerId) {
          connectServerRef.current(activeServerId);
        }
        controller.open({ projectId, workingDirectory });
      }
      return;
    }
    if (state.kind === 'detached') {
      controller.attach();
      return;
    }
    if (state.kind === 'failed' && mode === 'attach' && !fallbackUsedRef.current) {
      fallbackUsedRef.current = true;
      controller.open({ projectId, workingDirectory });
    }
  }, [
    controller,
    state.kind,
    mode,
    projectId,
    workingDirectory,
    activeServerId,
    facadeConnectionState,
    facadeBackends,
  ]);

  // ---- render ----

  if (state.kind === 'failed' && fallbackUsedRef.current) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-xs px-4">
        Terminal failed: {state.error}
      </div>
    );
  }

  if (state.kind === 'exited') {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs px-4">
        Process exited (code {state.code})
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ backgroundColor: 'hsl(var(--terminal-bg))' }}
      onPointerDown={() => controller.focus()}
    />
  );
}
