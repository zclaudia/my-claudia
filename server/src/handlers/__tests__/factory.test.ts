import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCrudHandlers, createHandler } from '../factory.js';
import { AppError } from '../../middleware/error.js';
import type { Repository } from '../../repositories/base.js';
import type { MessageContext } from '../../middleware/base.js';

// Mock repository
const createMockRepository = <T, TCreate, TUpdate>(): Repository<T, TCreate, TCreate> => ({
  findAll: vi.fn(),
  findById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
});

// Helper to create MessageContext
const createMockContext = (payload: any = {}): MessageContext => ({
  request: {
    type: 'test_message',
    payload,
  },
  send: vi.fn(),
  clientId: 'test-client',
});

describe('handlers/factory', () => {
  describe('createCrudHandlers', () => {
    describe('list handler', () => {
      it('returns all entities from repository', async () => {
        const mockRepo = createMockRepository();
        const mockItems = [{ id: '1', name: 'Item 1' }, { id: '2', name: 'Item 2' }];
        vi.mocked(mockRepo.findAll).mockResolvedValue(mockItems as any);

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext();

        const result = await handlers.list(ctx);

        expect(mockRepo.findAll).toHaveBeenCalledOnce();
        expect(result).toEqual({
          type: 'items_list',
          payload: { items: mockItems },
          requestId: undefined,
        });
      });

      it('throws DATABASE_ERROR on repository failure', async () => {
        const mockRepo = createMockRepository();
        vi.mocked(mockRepo.findAll).mockRejectedValue(new Error('DB connection failed'));

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext();

        await expect(handlers.list(ctx)).rejects.toThrow(AppError);
        await expect(handlers.list(ctx)).rejects.toMatchObject({
          code: 'DATABASE_ERROR',
        });
      });
    });

    describe('create handler', () => {
      it('creates entity with direct payload format', async () => {
        const mockRepo = createMockRepository();
        const newItem = { id: '1', name: 'New Item' };
        const createData = { name: 'New Item' };
        vi.mocked(mockRepo.create).mockResolvedValue(newItem as any);

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext(createData);

        const result = await handlers.create(ctx);

        expect(mockRepo.create).toHaveBeenCalledWith(createData);
        expect(result).toEqual({
          type: 'items_created',
          payload: { item: newItem },
          requestId: undefined,
        });
      });

      it('creates entity with nested payload format', async () => {
        const mockRepo = createMockRepository();
        const newItem = { id: '1', name: 'New Item' };
        const createData = { name: 'New Item' };
        vi.mocked(mockRepo.create).mockResolvedValue(newItem as any);

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ item: createData });

        const result = await handlers.create(ctx);

        expect(mockRepo.create).toHaveBeenCalledWith(createData);
        expect(result).toEqual({
          type: 'items_created',
          payload: { item: newItem },
          requestId: undefined,
        });
      });

      it('throws VALIDATION_ERROR for invalid data', async () => {
        const mockRepo = createMockRepository();
        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext(null);

        await expect(handlers.create(ctx)).rejects.toThrow(AppError);
        await expect(handlers.create(ctx)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      });

      it('throws VALIDATION_ERROR for non-object data', async () => {
        const mockRepo = createMockRepository();
        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext('string-data');

        await expect(handlers.create(ctx)).rejects.toThrow(AppError);
        await expect(handlers.create(ctx)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      });

      it('throws DATABASE_ERROR on repository failure', async () => {
        const mockRepo = createMockRepository();
        vi.mocked(mockRepo.create).mockRejectedValue(new Error('DB error'));

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ name: 'Test' });

        await expect(handlers.create(ctx)).rejects.toThrow(AppError);
        await expect(handlers.create(ctx)).rejects.toMatchObject({
          code: 'DATABASE_ERROR',
        });
      });

      it('preserves AppError from nested operations', async () => {
        const mockRepo = createMockRepository();
        const appError = new AppError('CUSTOM_ERROR', 'Custom error');
        vi.mocked(mockRepo.create).mockRejectedValue(appError);

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ name: 'Test' });

        await expect(handlers.create(ctx)).rejects.toThrow(appError);
      });
    });

    describe('update handler', () => {
      it('updates entity with id and data', async () => {
        const mockRepo = createMockRepository();
        const updatedItem = { id: '1', name: 'Updated' };
        vi.mocked(mockRepo.update).mockResolvedValue(updatedItem as any);

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ id: '1', name: 'Updated' });

        const result = await handlers.update(ctx);

        expect(mockRepo.update).toHaveBeenCalledWith('1', { id: '1', name: 'Updated' });
        expect(result).toEqual({
          type: 'items_updated',
          payload: { item: updatedItem },
          requestId: undefined,
        });
      });

      it('updates entity with nested payload format', async () => {
        const mockRepo = createMockRepository();
        const updatedItem = { id: '1', name: 'Updated' };
        vi.mocked(mockRepo.update).mockResolvedValue(updatedItem as any);

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ id: '1', item: { name: 'Updated' } });

        const result = await handlers.update(ctx);

        expect(mockRepo.update).toHaveBeenCalledWith('1', { name: 'Updated' });
        expect(result).toEqual({
          type: 'items_updated',
          payload: { item: updatedItem },
          requestId: undefined,
        });
      });

      it('throws VALIDATION_ERROR when id is missing', async () => {
        const mockRepo = createMockRepository();
        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ name: 'Updated' });

        await expect(handlers.update(ctx)).rejects.toThrow(AppError);
        await expect(handlers.update(ctx)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      });

      it('throws VALIDATION_ERROR when id is not string', async () => {
        const mockRepo = createMockRepository();
        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ id: 123, name: 'Updated' });

        await expect(handlers.update(ctx)).rejects.toThrow(AppError);
        await expect(handlers.update(ctx)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      });

      it('throws DATABASE_ERROR on repository failure', async () => {
        const mockRepo = createMockRepository();
        vi.mocked(mockRepo.update).mockRejectedValue(new Error('DB error'));

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ id: '1', name: 'Updated' });

        await expect(handlers.update(ctx)).rejects.toThrow(AppError);
        await expect(handlers.update(ctx)).rejects.toMatchObject({
          code: 'DATABASE_ERROR',
        });
      });
    });

    describe('delete handler', () => {
      it('deletes entity by id from payload.id', async () => {
        const mockRepo = createMockRepository();
        vi.mocked(mockRepo.delete).mockResolvedValue(true);

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ id: '1' });

        const result = await handlers.delete(ctx);

        expect(mockRepo.delete).toHaveBeenCalledWith('1');
        expect(result).toEqual({
          type: 'items_deleted',
          payload: { success: true, id: '1' },
          requestId: undefined,
        });
      });

      it('deletes entity when payload is just the id', async () => {
        const mockRepo = createMockRepository();
        vi.mocked(mockRepo.delete).mockResolvedValue(true);

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext('item-123');

        const result = await handlers.delete(ctx);

        expect(mockRepo.delete).toHaveBeenCalledWith('item-123');
        expect(result).toEqual({
          type: 'items_deleted',
          payload: { success: true, id: 'item-123' },
          requestId: undefined,
        });
      });

      it('throws VALIDATION_ERROR when id is missing', async () => {
        const mockRepo = createMockRepository();
        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({});

        await expect(handlers.delete(ctx)).rejects.toThrow(AppError);
        await expect(handlers.delete(ctx)).rejects.toMatchObject({
          code: 'VALIDATION_ERROR',
        });
      });

      it('throws NOT_FOUND when entity does not exist', async () => {
        const mockRepo = createMockRepository();
        vi.mocked(mockRepo.delete).mockResolvedValue(false);

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ id: 'nonexistent' });

        await expect(handlers.delete(ctx)).rejects.toThrow(AppError);
        await expect(handlers.delete(ctx)).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      });

      it('throws DATABASE_ERROR on repository failure', async () => {
        const mockRepo = createMockRepository();
        vi.mocked(mockRepo.delete).mockRejectedValue(new Error('DB error'));

        const handlers = createCrudHandlers('items', mockRepo);
        const ctx = createMockContext({ id: '1' });

        await expect(handlers.delete(ctx)).rejects.toThrow(AppError);
        await expect(handlers.delete(ctx)).rejects.toMatchObject({
          code: 'DATABASE_ERROR',
        });
      });
    });

    describe('singular name extraction', () => {
      it('extracts singular name by removing trailing s', async () => {
        const mockRepo = createMockRepository();
        vi.mocked(mockRepo.create).mockResolvedValue({ id: '1' } as any);

        const handlers = createCrudHandlers('servers', mockRepo);
        const ctx = createMockContext({ server: { name: 'Test' } });

        await handlers.create(ctx);

        // Should use 'server' as the key in response
        const result = await handlers.create(ctx);
        expect(result.payload).toHaveProperty('server');
      });
    });
  });

  describe('createHandler', () => {
    it('wraps custom handler and returns result', async () => {
      const ctx = createMockContext({ id: '1' });
      const customResult = { custom: 'data', count: 42 };

      const handler = createHandler('custom', async (c) => {
        expect(c).toBe(ctx);
        return customResult;
      });

      const result = await handler(ctx);

      expect(result).toEqual({
        type: 'custom_result',
        payload: customResult,
        requestId: undefined,
      });
    });

    it('preserves AppError from custom handler', async () => {
      const ctx = createMockContext({});
      const appError = new AppError('FORBIDDEN', 'Access denied');

      const handler = createHandler('custom', async () => {
        throw appError;
      });

      await expect(handler(ctx)).rejects.toThrow(appError);
    });

    it('wraps generic errors in HANDLER_ERROR', async () => {
      const ctx = createMockContext({});

      const handler = createHandler('custom', async () => {
        throw new Error('Something went wrong');
      });

      await expect(handler(ctx)).rejects.toThrow(AppError);
      await expect(handler(ctx)).rejects.toMatchObject({
        code: 'HANDLER_ERROR',
      });
    });
  });
});
