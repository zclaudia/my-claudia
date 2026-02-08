import type { Middleware } from './base.js';
import { errorResponse } from './base.js';

/**
 * Authentication middleware
 *
 * Verifies that the client is authenticated before allowing the request to proceed.
 * Local clients (connected directly to the server) are automatically allowed.
 * Remote clients must be authenticated (e.g., via gateway).
 *
 * Benefits:
 * - Single source of truth for authentication check
 * - Eliminates the 9 duplicated auth checks across handlers
 * - Consistent error responses for unauthorized requests
 * - Easy to modify auth logic in one place
 *
 * Example usage:
 * ```typescript
 * router.use(authMiddleware);  // Apply to all routes
 * // OR
 * router.crud('projects', repo, { middleware: [authMiddleware] });  // Apply to specific routes
 * ```
 */
export const authMiddleware: Middleware = async (ctx, next) => {
  // Local clients are always allowed (direct WebSocket connection)
  if (ctx.client.isLocal) {
    return next(ctx);
  }

  // Remote clients must be authenticated
  if (!ctx.client.authenticated) {
    return errorResponse(
      ctx.request,
      'UNAUTHORIZED',
      'Authentication required. Please provide a valid API key.'
    );
  }

  // Client is authenticated, proceed to next middleware/handler
  return next(ctx);
};

/**
 * Optional authentication middleware
 *
 * Similar to authMiddleware, but allows unauthenticated requests to proceed.
 * Useful for endpoints that have optional authentication (e.g., read-only operations
 * that work better with auth but don't require it).
 *
 * The handler can check ctx.client.authenticated to determine if the client is authenticated.
 */
export const optionalAuthMiddleware: Middleware = async (ctx, next) => {
  // Always allow the request to proceed
  // Handlers can check ctx.client.authenticated if needed
  return next(ctx);
};
