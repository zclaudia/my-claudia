import type { Database } from 'better-sqlite3';
import type { Request, Response } from '@my-claudia/shared';

/**
 * Connected client representation
 * This interface should match the ConnectedClient type from server.ts
 */
export interface ConnectedClient {
  id: string;
  ws: any;  // WebSocket instance
  authenticated: boolean;
  isLocal: boolean;
}

/**
 * Message context passed through middleware chain
 *
 * Contains all information needed to process a request:
 * - client: The connected client making the request
 * - request: The correlated request message
 * - db: Database instance for data access
 * - metadata: Map for passing data between middleware
 */
export interface MessageContext {
  client: ConnectedClient;
  request: Request;
  db: Database;
  metadata: Map<string, any>;
}

/**
 * Message handler function signature
 * Processes a request and optionally returns a response
 */
export type MessageHandler = (ctx: MessageContext) => Promise<Response | void>;

/**
 * Middleware function signature
 *
 * Middleware can:
 * - Modify the context before passing to next handler
 * - Short-circuit by returning a response without calling next
 * - Call next() to continue the chain
 * - Catch errors from downstream handlers
 *
 * Example:
 * ```typescript
 * const authMiddleware: Middleware = async (ctx, next) => {
 *   if (!ctx.client.authenticated) {
 *     return errorResponse('UNAUTHORIZED', 'Auth required');
 *   }
 *   return next(ctx);
 * };
 * ```
 */
export type Middleware = (ctx: MessageContext, next: MessageHandler) => Promise<Response | void>;

/**
 * Compose multiple middleware into a single middleware function
 *
 * Middleware are executed in order:
 * 1. First middleware runs
 * 2. It calls next() which runs the second middleware
 * 3. Second calls next() which runs the third, etc.
 * 4. Last middleware calls the final handler
 *
 * Response flows back up the chain in reverse order.
 *
 * Example:
 * ```typescript
 * const combined = composeMiddleware(
 *   loggingMiddleware,     // Runs first
 *   authMiddleware,        // Runs second
 *   errorHandlingMiddleware // Runs third
 * );
 * ```
 *
 * @param middlewares - Array of middleware functions to compose
 * @returns Single composed middleware function
 */
export function composeMiddleware(...middlewares: Middleware[]): Middleware {
  return (ctx, next) => {
    let index = -1;

    const dispatch = (i: number): Promise<Response | void> => {
      if (i <= index) {
        throw new Error('next() called multiple times');
      }
      index = i;

      const middleware = middlewares[i];
      if (!middleware) {
        // No more middleware, call the final handler
        return next(ctx);
      }

      // Call current middleware with a next function that dispatches the next middleware
      return middleware(ctx, () => dispatch(i + 1));
    };

    return dispatch(0);
  };
}

/**
 * Helper to create a success response
 */
export function successResponse<T>(request: Request, type: string, payload: T): Response<T> {
  return {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
    type,
    payload,
    timestamp: Date.now(),
    metadata: {
      requestId: request.id,
      success: true
    }
  };
}

/**
 * Helper to create an error response
 */
export function errorResponse(request: Request, code: string, message: string, details?: unknown): Response<null> {
  // Transform request type to response type
  // If type ends with .request, replace with .response
  // Otherwise, append .response
  const responseType = request.type.endsWith('.request')
    ? request.type.replace('.request', '.response')
    : `${request.type}.response`;

  return {
    id: `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`,
    type: responseType,
    payload: null,
    timestamp: Date.now(),
    metadata: {
      requestId: request.id,
      success: false,
      error: {
        code,
        message,
        details
      }
    }
  };
}
