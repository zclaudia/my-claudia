import type { Database } from 'better-sqlite3';
import type { Request, Response } from '@my-claudia/shared/protocol/correlation';
import type { ConnectedClient } from '../http/middleware/base.js';
import type { MessageContext, MessageHandler, Middleware } from '../http/middleware/base.js';
import type { Repository } from '../../infrastructure/repositories/base.js';
import { composeMiddleware, errorResponse } from '../http/middleware/base.js';
import { createCrudHandlers } from '../http/handlers/factory.js';

/**
 * Route registration options
 */
interface RouteOptions {
  middleware?: Middleware[];
}

/**
 * CRUD route registration options
 */
interface CrudRouteOptions {
  middleware?: Middleware[];
  messageTypes?: {
    list?: string;
    create?: string;
    update?: string;
    delete?: string;
  };
}

/**
 * MessageRouter
 *
 * Routes incoming WebSocket messages to appropriate handlers with middleware support.
 *
 * This router:
 * - Maps message types to handlers
 * - Supports middleware composition
 * - Provides CRUD registration shortcuts
 * - Coexists with existing switch statement (non-breaking)
 *
 * Benefits:
 * - Eliminates switch statement with 21+ cases
 * - Consistent middleware application
 * - Easy to add new routes
 * - Type-safe routing
 *
 * Example usage:
 * ```typescript
 * const router = new MessageRouter(db);
 *
 * // Apply global middleware
 * router.use(loggingMiddleware, errorHandlingMiddleware);
 *
 * // Register CRUD routes
 * router.crud('projects', projectRepo, {
 *   middleware: [authMiddleware],
 *   messageTypes: {
 *     list: 'get_projects',
 *     create: 'add_project',
 *     update: 'update_project',
 *     delete: 'delete_project'
 *   }
 * });
 *
 * // Register custom route
 * router.register('custom_action', customHandler, {
 *   middleware: [authMiddleware]
 * });
 *
 * // Route a message
 * const response = await router.route(client, request);
 * ```
 */
export class MessageRouter {
  private routes = new Map<string, MessageHandler>();
  private globalMiddleware: Middleware[] = [];

  constructor(private db: Database) {}

  /**
   * Add global middleware that applies to all routes
   */
  use(...middleware: Middleware[]): void {
    this.globalMiddleware.push(...middleware);
  }

  /**
   * Register a message handler for a specific message type
   */
  register(
    messageType: string,
    handler: MessageHandler,
    options?: RouteOptions
  ): void {
    // Compose route-specific middleware with global middleware
    const allMiddleware = [...this.globalMiddleware, ...(options?.middleware || [])];

    // Create final handler with middleware
    const finalHandler: MessageHandler = allMiddleware.length > 0
      ? async (ctx: MessageContext) => {
          const composed = composeMiddleware(...allMiddleware);
          return composed(ctx, handler);
        }
      : handler;

    this.routes.set(messageType, finalHandler);
  }

  /**
   * Register CRUD handlers for an entity
   *
   * This is a convenience method that registers all CRUD operations for an entity.
   *
   * @param entityName - Name of the entity (plural, e.g., 'projects')
   * @param repository - Repository instance
   * @param options - Options including middleware and custom message type names
   */
  crud<T, TCreate, TUpdate>(
    entityName: string,
    repository: Repository<T, TCreate, TUpdate>,
    options?: CrudRouteOptions
  ): void {
    const handlers = createCrudHandlers(entityName, repository);

    // Default message type names (matches existing convention)
    const messageTypes = options?.messageTypes || {
      list: `get_${entityName}`,
      create: `add_${entityName.slice(0, -1)}`,  // Remove 's' for singular
      update: `update_${entityName.slice(0, -1)}`,
      delete: `delete_${entityName.slice(0, -1)}`
    };

    // Register each CRUD handler
    this.register(messageTypes.list!, handlers.list, options);
    this.register(messageTypes.create!, handlers.create, options);
    this.register(messageTypes.update!, handlers.update, options);
    this.register(messageTypes.delete!, handlers.delete, options);

    console.log(`[Router] Registered CRUD routes for ${entityName}:`, Object.values(messageTypes));
  }

  /**
   * Route a message to its handler
   *
   * @param client - Connected client making the request
   * @param request - Correlated request message
   * @returns Response or void if no handler found
   */
  async route(
    client: ConnectedClient,
    request: Request
  ): Promise<Response | void> {
    const handler = this.routes.get(request.type);

    if (!handler) {
      // No route found - return void to fall through to switch statement
      return undefined;
    }

    // Create message context
    const ctx: MessageContext = {
      client,
      request,
      db: this.db,
      metadata: new Map()
    };

    try {
      return await handler(ctx);
    } catch (error) {
      // This should not happen if errorHandlingMiddleware is used
      // But handle it just in case
      console.error(`[Router] Unhandled error in route ${request.type}:`, error);
      return errorResponse(
        request,
        'INTERNAL_ERROR',
        error instanceof Error ? error.message : 'Unknown error'
      );
    }
  }

  /**
   * Check if a route exists for a message type
   */
  hasRoute(messageType: string): boolean {
    return this.routes.has(messageType);
  }

  /**
   * Get all registered route message types
   */
  getRoutes(): string[] {
    return Array.from(this.routes.keys());
  }

  /**
   * Clear all routes (useful for testing)
   */
  clear(): void {
    this.routes.clear();
  }
}

/**
 * Create a new MessageRouter instance
 */
export function createRouter(db: Database): MessageRouter {
  return new MessageRouter(db);
}
