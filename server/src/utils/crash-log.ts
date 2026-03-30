import * as fs from 'fs';
import * as path from 'path';

export interface CrashReportEntry {
  id: string;
  ts: number;
  process: 'server';
  event: 'uncaughtException' | 'startup_failure';
  version: string;
  pid: number;
  platform: NodeJS.Platform;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}

const MAX_LOG_ENTRIES = 100;
const MAX_FIELD_LENGTH = 16_000;

function getDataDir(): string {
  return process.env.MY_CLAUDIA_DATA_DIR
    ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR)
    : path.resolve('data');
}

function getCrashLogPath(): string {
  return path.join(getDataDir(), 'logs', 'crash-reports.jsonl');
}

function truncate(value: string | undefined): string | undefined {
  if (!value) return value;
  return value.length > MAX_FIELD_LENGTH ? `${value.slice(0, MAX_FIELD_LENGTH)}…` : value;
}

function ensureLogDirExists(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: truncate(error.message) || error.name,
      stack: truncate(error.stack),
    };
  }
  if (typeof error === 'string') {
    return { message: truncate(error) || 'Unknown error' };
  }
  try {
    return { message: truncate(JSON.stringify(error)) || 'Unknown error' };
  } catch {
    return { message: truncate(String(error)) || 'Unknown error' };
  }
}

function trimCrashLogFile(filePath: string): void {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const lines = raw.split('\n').filter(Boolean);
    if (lines.length <= MAX_LOG_ENTRIES) return;
    fs.writeFileSync(filePath, `${lines.slice(-MAX_LOG_ENTRIES).join('\n')}\n`, 'utf-8');
  } catch {
    // Best-effort only.
  }
}

export function writeCrashReportSync(input: {
  event: CrashReportEntry['event'];
  error: unknown;
  context?: Record<string, unknown>;
}): CrashReportEntry | null {
  try {
    const { message, stack } = normalizeError(input.error);
    const entry: CrashReportEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      ts: Date.now(),
      process: 'server',
      event: input.event,
      version: process.env.APP_VERSION || 'unknown',
      pid: process.pid,
      platform: process.platform,
      message,
      ...(stack ? { stack } : {}),
      ...(input.context ? { context: input.context } : {}),
    };

    const filePath = getCrashLogPath();
    ensureLogDirExists(filePath);
    fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, 'utf-8');
    trimCrashLogFile(filePath);
    return entry;
  } catch {
    return null;
  }
}

export function readCrashReports(limit = 20): CrashReportEntry[] {
  try {
    const filePath = getCrashLogPath();
    if (!fs.existsSync(filePath)) return [];
    const raw = fs.readFileSync(filePath, 'utf-8');
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as CrashReportEntry;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is CrashReportEntry => !!entry)
      .slice(-limit)
      .reverse();
  } catch {
    return [];
  }
}

export function getCrashLogFilePath(): string {
  return getCrashLogPath();
}
