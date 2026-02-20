import { useEffect, useRef } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { useConnection } from '../../contexts/ConnectionContext';
import { useTheme } from '../../contexts/ThemeContext';
import { xtermRegistry } from '../../utils/xtermRegistry';

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
}

export function XTerminal({ terminalId, projectId }: XTerminalProps) {
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
    // Small delay to let CSS variables update after class change
    const timer = setTimeout(() => {
      terminal.options.theme = getTerminalTheme();
    }, 50);
    return () => clearTimeout(timer);
  }, [resolvedTheme]);

  useEffect(() => {
    if (!containerRef.current) return;

    // Reuse existing terminal if available (StrictMode re-mount or drawer reopen)
    let terminal = xtermRegistry.get(terminalId);
    let isNew = false;

    if (!terminal) {
      isNew = true;
      const theme = getTerminalTheme();
      terminal = new Terminal({
        cursorBlink: true,
        fontSize: 14,
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        theme,
        allowProposedApi: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);
      terminal.loadAddon(new WebLinksAddon());
      fitAddonRef.current = fitAddon;
      xtermRegistry.set(terminalId, terminal);
    }

    terminalRef.current = terminal;

    // Re-attach to DOM (needed after StrictMode unmount/remount)
    if (containerRef.current.childElementCount === 0) {
      terminal.open(containerRef.current);
    }

    const fitAddon = fitAddonRef.current!;
    fitAddon.fit();

    if (isNew) {
      // Only send terminal_open for truly new terminals
      sendMessage({
        type: 'terminal_open',
        terminalId,
        projectId,
        cols: terminal.cols,
        rows: terminal.rows,
      });

      // Forward keystrokes to server
      terminal.onData((data) => {
        sendMessage({
          type: 'terminal_input',
          terminalId,
          data,
        });
      });
    }

    // Handle resize — skip when container is collapsed (height 0)
    resizeObserverRef.current?.disconnect();
    const resizeObserver = new ResizeObserver(() => {
      if (!containerRef.current || containerRef.current.clientHeight === 0) return;
      fitAddon.fit();
      sendMessage({
        type: 'terminal_resize',
        terminalId,
        cols: terminal!.cols,
        rows: terminal!.rows,
      });
    });
    resizeObserver.observe(containerRef.current);
    resizeObserverRef.current = resizeObserver;

    return () => {
      resizeObserver.disconnect();
      // Terminal instance and server-side pty are kept alive across drawer toggles.
      // They are cleaned up when the connection drops or the process exits.
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terminalId, projectId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ backgroundColor: 'hsl(var(--terminal-bg))' }}
    />
  );
}
