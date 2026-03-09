import { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useConnection } from '../../contexts/ConnectionContext';
import { useTheme } from '../../contexts/ThemeContext';
import { xtermRegistry } from '../../utils/xtermRegistry';
import { useTerminalStore } from '../../stores/terminalStore';

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
}

export function XTerminal({ terminalId, projectId, workingDirectory }: XTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { sendMessage } = useConnection();
  const { resolvedTheme } = useTheme();
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  // Update terminal theme when app theme changes
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;
    const timer = setTimeout(() => {
      terminal.options.theme = getTerminalTheme();
    }, 50);
    return () => clearTimeout(timer);
  }, [resolvedTheme]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Reuse existing terminal if available (StrictMode re-mount or drawer reopen).
    // The registry entry survives across StrictMode double-mount cycles.
    let entry = xtermRegistry.get(terminalId);

    if (!entry) {
      const theme = getTerminalTheme();
      const terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());
      xtermRegistry.set(terminalId, terminal, fitAddon);
      entry = xtermRegistry.get(terminalId)!;
    }

    const { terminal, fitAddon } = entry;
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const container = containerRef.current;

    // Attach terminal to DOM and send terminal_open when container is ready.
    // The container may initially have 0 height (BottomPanel renders with
    // height:0 when closed), so we defer until positive dimensions are available.
    // We use entry.serverOpened (persisted in the registry) instead of a local
    // variable so the flag survives React StrictMode's unmount/remount cycle.
    const attach = () => {
      if (!container || container.clientHeight === 0 || container.clientWidth === 0) return false;
      const termElement = (terminal as unknown as { element?: HTMLElement }).element;
      if (termElement) {
        if (termElement.parentElement !== container) {
          container.appendChild(termElement);
        }
      } else {
        terminal.open(container);
      }
      fitAddon.fit();
      const reg = xtermRegistry.get(terminalId);
      if (reg && !reg.serverOpened) {
        reg.serverOpened = true;
        sendMessage({
          type: 'terminal_open',
          terminalId,
          projectId,
          workingDirectory,
          cols: terminal.cols,
          rows: terminal.rows,
        });
        // Forward keystrokes to server (with sticky Ctrl support for mobile)
        terminal.onData((data) => {
          let sendData = data;
          const store = useTerminalStore.getState();
          if (store.ctrlActive[terminalId] && data.length === 1) {
            const code = data.charCodeAt(0);
            if (code >= 97 && code <= 122) {
              sendData = String.fromCharCode(code - 96);
            } else if (code >= 65 && code <= 90) {
              sendData = String.fromCharCode(code - 64);
            }
            store.toggleCtrl(terminalId);
          }
          sendMessage({
            type: 'terminal_input',
            terminalId,
            data: sendData,
          });
        });
      }
      return true;
    };

    // Try to attach in the next animation frame
    const rafId = requestAnimationFrame(() => attach());

    // ResizeObserver handles both deferred init (if RAF fires at 0 height)
    // and subsequent resize events.
    resizeObserverRef.current?.disconnect();
    const resizeObserver = new ResizeObserver(() => {
      if (!container || container.clientHeight === 0) return;
      const wasOpened = xtermRegistry.get(terminalId)?.serverOpened ?? false;
      if (!attach()) return;
      if (wasOpened) {
        sendMessage({
          type: 'terminal_resize',
          terminalId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      }
    });
    resizeObserver.observe(container);
    resizeObserverRef.current = resizeObserver;

    return () => {
      cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, projectId, workingDirectory]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ backgroundColor: 'hsl(var(--terminal-bg))' }}
    />
  );
}
