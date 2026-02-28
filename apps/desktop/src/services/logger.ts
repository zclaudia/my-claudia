/**
 * Client-side Logger Service
 *
 * Intercepts console.log/warn/error/debug and stores entries in a ring buffer.
 * Entries are structured with timestamp, level, tag (auto-extracted from [Tag] prefix),
 * and stringified arguments. Export as JSON for offline analysis.
 */

interface LogEntry {
  t: number;         // timestamp (ms)
  l: 'debug' | 'info' | 'warn' | 'error';
  tag: string;       // extracted from [Tag] prefix, or 'untagged'
  msg: string;       // first argument stringified
  args?: string;     // remaining arguments (truncated)
}

const TAG_RE = /^\[([^\]]+)\]\s*/;
const MAX_ARG_LEN = 500;

let buffer: LogEntry[] = [];
let maxEntries = 2000;
let initialized = false;

// Keep originals for passthrough
let _log: typeof console.log;
let _warn: typeof console.warn;
let _error: typeof console.error;
let _debug: typeof console.debug;

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractTag(first: string): { tag: string; message: string } {
  const match = TAG_RE.exec(first);
  if (match) {
    return { tag: match[1], message: first.slice(match[0].length) };
  }
  return { tag: 'untagged', message: first };
}

function capture(level: LogEntry['l'], args: unknown[]): void {
  if (args.length === 0) return;

  const firstStr = stringify(args[0]);
  const { tag, message } = extractTag(firstStr);

  const entry: LogEntry = {
    t: Date.now(),
    l: level,
    tag,
    msg: message,
  };

  if (args.length > 1) {
    const rest = args.slice(1).map(stringify).join(' ');
    entry.args = rest.length > MAX_ARG_LEN ? rest.slice(0, MAX_ARG_LEN) + '…' : rest;
  }

  buffer.push(entry);
  if (buffer.length > maxEntries) {
    // Drop oldest 10% when full to avoid shifting on every insert
    buffer = buffer.slice(Math.floor(maxEntries * 0.1));
  }
}

export function initLogger(max?: number): void {
  if (initialized) return;
  initialized = true;
  if (max) maxEntries = max;

  _log = console.log.bind(console);
  _warn = console.warn.bind(console);
  _error = console.error.bind(console);
  _debug = console.debug.bind(console);

  console.log = (...args: unknown[]) => { capture('info', args); _log(...args); };
  console.warn = (...args: unknown[]) => { capture('warn', args); _warn(...args); };
  console.error = (...args: unknown[]) => { capture('error', args); _error(...args); };
  console.debug = (...args: unknown[]) => { capture('debug', args); _debug(...args); };
}

export function exportLogs(): string {
  return JSON.stringify(buffer);
}

export function clearLogs(): void {
  buffer = [];
}

export function getLogCount(): number {
  return buffer.length;
}
