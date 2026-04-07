import type { Middleware } from './base.js';

/**
 * Logging middleware
 *
 * Logs all incoming requests and their responses, including:
 * - Request type and client ID
 * - Request processing time
 * - Success/failure status
 *
 * Benefits:
 * - Consistent logging format across all requests
 * - Performance monitoring (request duration)
 * - Easy debugging (see request flow)
 * - Single place to modify logging behavior
 *
 * Example usage:
 * ```typescript
 * router.use(loggingMiddleware);  // Log all requests
 * ```
 */
export const loggingMiddleware: Middleware = async (ctx, next) => {
  const start = Date.now();
  const { type, id } = ctx.request;
  const clientId = ctx.client.id;

  console.log(`[Request] ${type} (id: ${id}) from client ${clientId}`);

  try {
    const response = await next(ctx);
    const duration = Date.now() - start;

    if (response) {
      const status = response.metadata.success ? 'SUCCESS' : 'FAILED';
      console.log(`[Response] ${type} ${status} in ${duration}ms`);
    } else {
      console.log(`[Response] ${type} completed in ${duration}ms (no response)`);
    }

    return response;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[Error] ${type} failed after ${duration}ms:`, error);
    throw error;
  }
};

/**
 * Detailed logging middleware (for debugging)
 *
 * Logs additional details like:
 * - Request payload
 * - Response payload
 * - Client authentication status
 *
 * Use this for development/debugging, not in production (may log sensitive data).
 */
export const detailedLoggingMiddleware: Middleware = async (ctx, next) => {
  const start = Date.now();
  const { type, id, payload } = ctx.request;
  const { id: clientId, authenticated, isLocal } = ctx.client;

  console.log(`[Request Details]`, {
    type,
    requestId: id,
    clientId,
    authenticated,
    isLocal,
    payload: JSON.stringify(payload).substring(0, 200)  // Truncate large payloads
  });

  try {
    const response = await next(ctx);
    const duration = Date.now() - start;

    if (response) {
      console.log(`[Response Details]`, {
        type,
        requestId: id,
        success: response.metadata.success,
        duration,
        error: response.metadata.error,
        payloadSize: JSON.stringify(response.payload).length
      });
    }

    return response;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`[Error Details]`, {
      type,
      requestId: id,
      duration,
      error: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    throw error;
  }
};
