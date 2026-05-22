export type SetPassthrough = (passthrough: boolean) => Promise<unknown>;

export interface PassthroughControllerOptions {
  retryDelayMs?: number;
  onError?: (error: unknown, requested: boolean) => void;
}

export interface PassthroughControllerState {
  requested: boolean | null;
  applied: boolean | null;
  inFlight: boolean;
  lastError: unknown | null;
}

export interface PassthroughController {
  set: (passthrough: boolean) => Promise<void>;
  ensure: (passthrough: boolean) => Promise<void>;
  getState: () => PassthroughControllerState;
  dispose: () => void;
}

const DEFAULT_RETRY_DELAY_MS = 500;

export function createPassthroughController(
  apply: SetPassthrough,
  options: PassthroughControllerOptions = {},
): PassthroughController {
  let requested: boolean | null = null;
  let applied: boolean | null = null;
  let inFlight: Promise<void> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let lastError: unknown | null = null;
  let forceRequested = false;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;

  const clearRetry = () => {
    if (!retryTimer) return;
    clearTimeout(retryTimer);
    retryTimer = null;
  };

  const scheduleRetry = () => {
    if (disposed || retryTimer || (requested === applied && !forceRequested)) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void startFlush().catch(() => undefined);
    }, retryDelayMs);
  };

  const flush = async () => {
    while (!disposed && (requested !== applied || forceRequested)) {
      const next = requested;
      if (next === null) return;
      const wasForced = forceRequested;
      forceRequested = false;
      try {
        await apply(next);
        applied = next;
        lastError = null;
      } catch (error) {
        if (wasForced && requested === applied) {
          forceRequested = true;
        }
        lastError = error;
        options.onError?.(error, next);
        throw error;
      }
    }
  };

  const startFlush = () => {
    if (disposed) return Promise.resolve();
    clearRetry();
    if (!inFlight) {
      inFlight = flush()
        .catch((error) => {
          scheduleRetry();
          throw error;
        })
        .finally(() => {
          inFlight = null;
        });
    }
    return inFlight;
  };

  const set = (passthrough: boolean) => {
    requested = passthrough;
    return startFlush();
  };

  const ensure = (passthrough: boolean) => {
    requested = passthrough;
    if (!inFlight && requested === applied) {
      forceRequested = true;
    }
    return startFlush();
  };

  return {
    set,
    ensure,
    getState: () => ({
      requested,
      applied,
      inFlight: inFlight !== null,
      lastError,
    }),
    dispose: () => {
      disposed = true;
      clearRetry();
    },
  };
}
