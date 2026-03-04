import type { Middleware } from './base.js';
import { errorResponse } from './base.js';

/**
 * Custom error class for application-specific errors
 */
export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Error handling middleware
 *
 * Catches all errors thrown by downstream handlers and converts them
 * into standardized error responses.
 *
 * Benefits:
 * - Eliminates 70+ duplicated error response patterns
 * - Consistent error format across all endpoints
 * - Single place to customize error handling
 * - Prevents unhandled errors from crashing the server
 * - Proper error logging
 *
 * Error types handled:
 * - AppError: Application-specific errors with error codes
 * - Error: Generic JavaScript errors
 * - Unknown: Non-error objects thrown
 *
 * Example usage:
 * ```typescript
 * router.use(errorHandlingMiddleware);  // Catch all errors
 * ```
 *
 * Example throwing errors in handlers:
 * ```typescript
 * throw new AppError('NOT_FOUND', 'Project not found', { projectId: '123' });
 * throw new Error('Database connection failed');
 * ```
 */
export const errorHandlingMiddleware: Middleware = async (ctx, next) => {
  try {
    return await next(ctx);
  } catch (error) {
    // Log the error for debugging
    console.error(`[ErrorMiddleware] Error processing ${ctx.request.type}:`, error);

    // Handle AppError with custom error code
    if (error instanceof AppError) {
      return errorResponse(
        ctx.request,
        error.code,
        error.message,
        error.details
      );
    }

    // Handle generic Error
    if (error instanceof Error) {
      // Extract error code from error if it has one
      const code = (error as any).code || 'INTERNAL_ERROR';
      return errorResponse(
        ctx.request,
        code,
        error.message
      );
    }

    // Handle unknown error types
    return errorResponse(
      ctx.request,
      'INTERNAL_ERROR',
      'An unexpected error occurred',
      { error: String(error) }
    );
  }
};

/**
 * Validation error handling middleware
 *
 * Catches validation errors and returns user-friendly error messages.
 * Should be placed before errorHandlingMiddleware in the middleware chain.
 *
 * Example validation error:
 * ```typescript
 * if (!data.name) {
 *   throw new AppError('VALIDATION_ERROR', 'Name is required', { field: 'name' });
 * }
 * ```
 */
export const validationErrorMiddleware: Middleware = async (ctx, next) => {
  try {
    return await next(ctx);
  } catch (error) {
    if (error instanceof AppError && error.code === 'VALIDATION_ERROR') {
      console.log(`[ValidationError] ${error.message}`, error.details);
      return errorResponse(
        ctx.request,
        'VALIDATION_ERROR',
        error.message,
        error.details
      );
    }
    // Not a validation error, re-throw to be handled by errorHandlingMiddleware
    throw error;
  }
};

/**
 * Database error handling middleware
 *
 * Catches database-specific errors and converts them to user-friendly messages.
 * Should be placed before errorHandlingMiddleware in the middleware chain.
 *
 * Example:
 * ```typescript
 * router.use(loggingMiddleware, dbErrorMiddleware, errorHandlingMiddleware);
 * ```
 */
export const dbErrorMiddleware: Middleware = async (ctx, next) => {
  try {
    return await next(ctx);
  } catch (error) {
    if (error instanceof Error) {
      const normalizedMessage = error.message.toLowerCase();

      // SQLite constraint violation (e.g., UNIQUE constraint)
      if (normalizedMessage.includes('unique constraint')) {
        return errorResponse(
          ctx.request,
          'DUPLICATE_ERROR',
          'A record with this information already exists',
          { originalError: error.message }
        );
      }

      // SQLite foreign key constraint
      if (normalizedMessage.includes('foreign key constraint')) {
        return errorResponse(
          ctx.request,
          'REFERENCE_ERROR',
          'Cannot perform this operation due to existing references',
          { originalError: error.message }
        );
      }

      // Database not found / not accessible
      if (error.message.includes('no such table') || error.message.includes('database is locked')) {
        return errorResponse(
          ctx.request,
          'DATABASE_ERROR',
          'Database error occurred',
          { originalError: error.message }
        );
      }
    }

    // Not a database error, re-throw
    throw error;
  }
};
