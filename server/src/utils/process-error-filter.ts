function getErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' ? code : undefined;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error ?? '');
}

function getErrorStack(error: unknown): string {
  if (error instanceof Error) return error.stack || '';
  return '';
}

/**
 * Broken pipe / connection reset errors can bubble out of SDK internals as
 * uncaught socket events after the run has already failed cleanly.
 * Treat those as non-fatal so the embedded server stays alive.
 */
export function isIgnorableProcessError(error: unknown): boolean {
  const code = getErrorCode(error);
  const message = getErrorMessage(error);
  const stack = getErrorStack(error);
  const combined = `${message}\n${stack}`.toLowerCase();

  if (code !== 'EPIPE' && code !== 'ECONNRESET') {
    return false;
  }

  return (
    combined.includes('socket') ||
    combined.includes('stream_base_commons') ||
    combined.includes('streams/destroy') ||
    combined.includes('node:_http_client') ||
    combined.includes('syscall: write') ||
    combined.includes('read econnreset') ||
    combined.includes('socket hang up')
  );
}
