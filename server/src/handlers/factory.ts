import type { Repository } from '../repositories/base.js';
import type { MessageContext, MessageHandler } from '../middleware/base.js';
import { successResponse, errorResponse } from '../middleware/base.js';
import { AppError } from '../middleware/error.js';

/**
 * CRUD Handler Factory
 *
 * Generates standardized CRUD handlers for any entity with a Repository.
 * This eliminates the need to write repetitive handler functions.
 *
 * Benefits:
 * - 21 handler functions → 4 registrations (95% reduction)
 * - Consistent behavior across all entities
 * - Single source of truth for CRUD operations
 * - Adding new entity: 1 line of code
 *
 * Example usage:
 * ```typescript
 * const projectHandlers = createCrudHandlers('projects', projectRepo);
 * router.register('get_projects', projectHandlers.list);
 * router.register('add_project', projectHandlers.create);
 * router.register('update_project', projectHandlers.update);
 * router.register('delete_project', projectHandlers.delete);
 * ```
 */

export interface CrudHandlers {
  list: MessageHandler;
  create: MessageHandler;
  update: MessageHandler;
  delete: MessageHandler;
}

/**
 * Create CRUD handlers for an entity
 *
 * @param entityName - Name of the entity (e.g., 'projects', 'sessions')
 * @param repository - Repository instance for the entity
 * @returns Object containing list, create, update, delete handlers
 */
export function createCrudHandlers<T, TCreate, TUpdate>(
  entityName: string,
  repository: Repository<T, TCreate, TUpdate>
): CrudHandlers {
  const singularName = entityName.slice(0, -1); // 'servers' → 'server'

  // List all entities
  const list: MessageHandler = async (ctx: MessageContext) => {
    try {
      const items = await repository.findAll();

      return successResponse(
        ctx.request,
        `${entityName}_list`,
        { [entityName]: items }
      );
    } catch (error) {
      throw new AppError(
        'DATABASE_ERROR',
        `Failed to list ${entityName}`,
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  };

  // Create new entity
  const create: MessageHandler = async (ctx: MessageContext) => {
    try {
      const payload = ctx.request.payload as any;

      // Validate payload exists first
      if (!payload || typeof payload !== 'object') {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid ${entityName} data`,
          { payload: ctx.request.payload }
        );
      }

      // Old-format messages nest entity data under the singular key
      // e.g. { type: 'add_server', server: { name, address, ... } }
      const data = (payload[singularName] || payload) as TCreate;

      // Validate data exists
      if (!data || typeof data !== 'object') {
        throw new AppError(
          'VALIDATION_ERROR',
          `Invalid ${entityName} data`,
          { payload: ctx.request.payload }
        );
      }

      const created = await repository.create(data);

      return successResponse(
        ctx.request,
        `${entityName}_created`,
        { [singularName]: created }
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'DATABASE_ERROR',
        `Failed to create ${singularName}`,
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  };

  // Update existing entity
  const update: MessageHandler = async (ctx: MessageContext) => {
    try {
      const payload = ctx.request.payload as any;
      const id = payload.id;
      // Old-format messages nest entity data under the singular key
      // e.g. { type: 'update_server', id: '...', server: { name, ... } }
      const data = (payload[singularName] || payload) as TUpdate;

      // Validate ID
      if (!id || typeof id !== 'string') {
        throw new AppError(
          'VALIDATION_ERROR',
          'Entity ID is required',
          { payload: ctx.request.payload }
        );
      }

      const updated = await repository.update(id, data as TUpdate);

      return successResponse(
        ctx.request,
        `${entityName}_updated`,
        { [singularName]: updated }
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'DATABASE_ERROR',
        `Failed to update ${singularName}`,
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  };

  // Delete entity
  const deleteHandler: MessageHandler = async (ctx: MessageContext) => {
    try {
      const payload = ctx.request.payload as any;
      const id = payload.id || payload;

      // Validate ID
      if (!id || typeof id !== 'string') {
        throw new AppError(
          'VALIDATION_ERROR',
          'Entity ID is required',
          { payload: ctx.request.payload }
        );
      }

      const deleted = await repository.delete(id);

      if (!deleted) {
        throw new AppError(
          'NOT_FOUND',
          `${singularName} not found`,
          { id }
        );
      }

      return successResponse(
        ctx.request,
        `${entityName}_deleted`,
        { success: true, id }
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'DATABASE_ERROR',
        `Failed to delete ${singularName}`,
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  };

  return {
    list,
    create,
    update,
    delete: deleteHandler
  };
}

/**
 * Helper to create a single handler from repository method
 *
 * This is useful for custom operations beyond basic CRUD.
 *
 * Example:
 * ```typescript
 * const getProjectById = createHandler(
 *   'project',
 *   async (ctx) => {
 *     const { id } = ctx.request.payload;
 *     return projectRepo.findById(id);
 *   }
 * );
 * ```
 */
export function createHandler<T>(
  entityName: string,
  handler: (ctx: MessageContext) => Promise<T>
): MessageHandler {
  return async (ctx: MessageContext) => {
    try {
      const result = await handler(ctx);

      return successResponse(
        ctx.request,
        `${entityName}_result`,
        result
      );
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(
        'HANDLER_ERROR',
        `Failed to handle ${entityName} request`,
        { error: error instanceof Error ? error.message : 'Unknown error' }
      );
    }
  };
}
