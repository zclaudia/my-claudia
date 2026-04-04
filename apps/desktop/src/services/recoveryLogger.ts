type RecoveryLogLevel = 'debug' | 'info' | 'warn' | 'error';

interface RecoveryLogPayload {
  [key: string]: unknown;
}

const RECOVERY_TRACE_STORAGE_KEY = 'my-claudia:recovery-trace';

// Ring buffer for diagnosing mobile recovery issues via adb / devtools.
// Access from console: window.__recoveryLog
// On mobile, last few entries are also stored in localStorage for adb extraction.
const MAX_LOG_ENTRIES = 200;
const ringBuffer: string[] = [];
if (typeof window !== 'undefined') {
  (window as any).__recoveryLog = ringBuffer;
  (window as any).__dumpRecoveryLog = () => ringBuffer.join('\n');
}

// Persist last N entries to localStorage so we can extract via adb backup/run-as
const PERSIST_ENTRIES = 30;
let recoveryTraceEnabled = false;

function readPersistedTraceFlag(): boolean {
  try {
    return typeof localStorage !== 'undefined'
      && localStorage.getItem(RECOVERY_TRACE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function isRecoveryTraceLoggingEnabled(): boolean {
  return recoveryTraceEnabled || readPersistedTraceFlag();
}

export function setRecoveryTraceLoggingEnabled(enabled: boolean): void {
  recoveryTraceEnabled = enabled;
  try {
    if (typeof localStorage === 'undefined') return;
    if (enabled) {
      localStorage.setItem(RECOVERY_TRACE_STORAGE_KEY, '1');
    } else {
      localStorage.removeItem(RECOVERY_TRACE_STORAGE_KEY);
      localStorage.removeItem('__recovery_debug');
    }
  } catch {
    // Ignore storage failures.
  }
}

function persistToStorage(): void {
  if (!isRecoveryTraceLoggingEnabled()) return;
  try {
    if (typeof localStorage !== 'undefined') {
      const tail = ringBuffer.slice(-PERSIST_ENTRIES);
      localStorage.setItem('__recovery_debug', tail.join('\n'));
    }
  } catch { /* ignore */ }
}

function log(level: RecoveryLogLevel, event: string, payload?: RecoveryLogPayload): void {
  const message = `[Recovery] ${event}`;
  const ts = new Date().toISOString().slice(11, 23);
  const entry = payload
    ? `${ts} [${level}] ${event} ${JSON.stringify(payload)}`
    : `${ts} [${level}] ${event}`;

  if (isRecoveryTraceLoggingEnabled()) {
    ringBuffer.push(entry);
    if (ringBuffer.length > MAX_LOG_ENTRIES) ringBuffer.splice(0, ringBuffer.length - MAX_LOG_ENTRIES);
    persistToStorage();
  }

  if (payload) {
    console[level](message, payload);
    return;
  }
  console[level](message);
}

export function logRecoveryEvent(event: string, payload?: RecoveryLogPayload): void {
  if (!isRecoveryTraceLoggingEnabled()) return;
  log('debug', event, payload);
}

export function logRecoveryPlan(event: string, payload?: RecoveryLogPayload): void {
  if (!isRecoveryTraceLoggingEnabled()) return;
  log('debug', event, payload);
}

export function logRecoveryEffect(event: string, payload?: RecoveryLogPayload): void {
  if (!isRecoveryTraceLoggingEnabled()) return;
  log('info', event, payload);
}

export function logRecoveryTransition(event: string, payload?: RecoveryLogPayload): void {
  if (!isRecoveryTraceLoggingEnabled()) return;
  log('info', event, payload);
}

export function logRecoveryWarning(event: string, payload?: RecoveryLogPayload): void {
  log('warn', event, payload);
}
