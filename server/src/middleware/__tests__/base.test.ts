import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  composeMiddleware,
  successResponse,
  errorResponse,
  type Middleware,
  type MessageContext,
  type MessageHandler,
} from '../base.js';
import type { Request, Response } from '@my-claudia/shared';

describe('middleware/base', () => {
  let mockCtx: MessageContext;

  beforeEach(() => {
    mockCtx = {
      client: {
        id: 'client-1',
        ws: {},
        authenticated: true,
        isLocal: true,
      },
      request: {
        id: 'req-1',
        type: 'test.request',
        payload: { data: 'test' },
        timestamp: Date.now(),
      },
      db: {} as any,
      metadata: new Map(),
    };
  });

  describe('composeMiddleware', () => {
    it('executes middleware in order', async () => {
      const order: number[] = [];

      const middleware1: Middleware = async (ctx, next) => {
        order.push(1);
        const result = await next(ctx);
        order.push(4);
        return result;
      };

      const middleware2: Middleware = async (ctx, next) => {
        order.push(2);
        const result = await next(ctx);
        order.push(3);
        return result;
      };

      const finalHandler: MessageHandler = async () => {
        order.push(5);
        return { id: 'resp-1', type: 'test.response', payload: 'done', timestamp: Date.now(), metadata: { success: true } };
      };

      const composed = composeMiddleware(middleware1, middleware2);
      await composed(mockCtx, finalHandler);

      expect(order).toEqual([1, 2, 5, 3, 4]);
    });

    it('passes context through chain', async () => {
      const middleware1: Middleware = async (ctx, next) => {
        ctx.metadata.set('step1', 'value1');
        return next(ctx);
      };

      const middleware2: Middleware = async (ctx, next) => {
        expect(ctx.metadata.get('step1')).toBe('value1');
        ctx.metadata.set('step2', 'value2');
        return next(ctx);
      };

      const finalHandler: MessageHandler = async (ctx) => {
        expect(ctx.metadata.get('step1')).toBe('value1');
        expect(ctx.metadata.get('step2')).toBe('value2');
        return { id: 'resp-1', type: 'test.response', payload: 'done', timestamp: Date.now(), metadata: { success: true } };
      };

      const composed = composeMiddleware(middleware1, middleware2);
      await composed(mockCtx, finalHandler);
    });

    it('short-circuits when middleware returns response', async () => {
      const order: string[] = [];

      const authMiddleware: Middleware = async (ctx, next) => {
        if (!ctx.client.authenticated) {
          return {
            id: 'resp-1',
            type: 'error.response',
            payload: null,
            timestamp: Date.now(),
            metadata: { success: false, error: { code: 'UNAUTHORIZED', message: 'Not authenticated' } },
          };
        }
        return next(ctx);
      };

      const trackingMiddleware: Middleware = async (ctx, next) => {
        order.push('tracking');
        return next(ctx);
      };

      const finalHandler: MessageHandler = async () => {
        order.push('final');
        return { id: 'resp-1', type: 'test.response', payload: 'done', timestamp: Date.now(), metadata: { success: true } };
      };

      // Test with authenticated client - full chain executes
      const composed = composeMiddleware(authMiddleware, trackingMiddleware);
      await composed(mockCtx, finalHandler);
      expect(order).toContain('tracking');
      expect(order).toContain('final');

      // Test with unauthenticated client - short-circuits
      order.length = 0;
      mockCtx.client.authenticated = false;
      const response = await composed(mockCtx, finalHandler);
      expect(order).not.toContain('tracking');
      expect(order).not.toContain('final');
      expect(response?.metadata.success).toBe(false);
    });

    it('throws when next() called multiple times', async () => {
      const badMiddleware: Middleware = async (ctx, next) => {
        await next(ctx);
        await next(ctx); // Second call should throw
        return undefined;
      };

      const finalHandler: MessageHandler = async () => ({
        id: 'resp-1', type: 'test.response', payload: 'done', timestamp: Date.now(), metadata: { success: true }
      });

      const composed = composeMiddleware(badMiddleware);
      await expect(composed(mockCtx, finalHandler)).rejects.toThrow('next() called multiple times');
    });

    it('propagates errors up the chain', async () => {
      const errorMiddleware: Middleware = async () => {
        throw new Error('Something went wrong');
      };

      const finalHandler: MessageHandler = async () => ({
        id: 'resp-1', type: 'test.response', payload: 'done', timestamp: Date.now(), metadata: { success: true }
      });

      const composed = composeMiddleware(errorMiddleware);
      await expect(composed(mockCtx, finalHandler)).rejects.toThrow('Something went wrong');
    });

    it('middleware can catch errors from downstream', async () => {
      const catchErrorMiddleware: Middleware = async (ctx, next) => {
        try {
          return await next(ctx);
        } catch (error) {
          return {
            id: 'resp-1',
            type: 'error.response',
            payload: null,
            timestamp: Date.now(),
            metadata: {
              success: false,
              error: {
                code: 'CAUGHT',
                message: error instanceof Error ? error.message : 'Unknown error',
              },
            },
          };
        }
      };

      const errorMiddleware: Middleware = async () => {
        throw new Error('Downstream error');
      };

      const finalHandler: MessageHandler = async () => ({
        id: 'resp-1', type: 'test.response', payload: 'done', timestamp: Date.now(), metadata: { success: true }
      });

      const composed = composeMiddleware(catchErrorMiddleware, errorMiddleware);
      const response = await composed(mockCtx, finalHandler);

      expect(response?.metadata.success).toBe(false);
      expect(response?.metadata.error?.code).toBe('CAUGHT');
      expect(response?.metadata.error?.message).toBe('Downstream error');
    });

    it('works with empty middleware array', async () => {
      const finalHandler: MessageHandler = async () => ({
        id: 'resp-1', type: 'test.response', payload: 'done', timestamp: Date.now(), metadata: { success: true }
      });

      const composed = composeMiddleware();
      const response = await composed(mockCtx, finalHandler);

      expect(response?.payload).toBe('done');
    });

    it('works with single middleware', async () => {
      const middleware: Middleware = async (ctx, next) => {
        ctx.metadata.set('called', true);
        return next(ctx);
      };

      const finalHandler: MessageHandler = async (ctx) => {
        expect(ctx.metadata.get('called')).toBe(true);
        return { id: 'resp-1', type: 'test.response', payload: 'done', timestamp: Date.now(), metadata: { success: true } };
      };

      const composed = composeMiddleware(middleware);
      await composed(mockCtx, finalHandler);
    });
  });

  describe('successResponse', () => {
    it('creates response with correct structure', () => {
      const request: Request = {
        id: 'req-123',
        type: 'user.list.request',
        payload: {},
        timestamp: Date.now(),
      };

      const response = successResponse(request, 'user.list.response', { users: ['Alice', 'Bob'] });

      expect(response.type).toBe('user.list.response');
      expect(response.payload).toEqual({ users: ['Alice', 'Bob'] });
      expect(response.metadata.success).toBe(true);
    });

    it('includes request ID in metadata', () => {
      const request: Request = {
        id: 'req-456',
        type: 'test.request',
        payload: {},
        timestamp: Date.now(),
      };

      const response = successResponse(request, 'test.response', {});

      expect(response.metadata.requestId).toBe('req-456');
    });

    it('generates unique response IDs', () => {
      const request: Request = {
        id: 'req-789',
        type: 'test.request',
        payload: {},
        timestamp: Date.now(),
      };

      const response1 = successResponse(request, 'test.response', {});
      const response2 = successResponse(request, 'test.response', {});

      expect(response1.id).not.toBe(response2.id);
    });

    it('sets timestamp correctly', () => {
      const before = Date.now();
      const request: Request = {
        id: 'req-123',
        type: 'test.request',
        payload: {},
        timestamp: Date.now(),
      };
      const response = successResponse(request, 'test.response', {});
      const after = Date.now();

      expect(response.timestamp).toBeGreaterThanOrEqual(before);
      expect(response.timestamp).toBeLessThanOrEqual(after);
    });
  });

  describe('errorResponse', () => {
    it('creates error response with code and message', () => {
      const request: Request = {
        id: 'req-123',
        type: 'user.delete.request',
        payload: {},
        timestamp: Date.now(),
      };

      const response = errorResponse(request, 'NOT_FOUND', 'User not found');

      expect(response.payload).toBeNull();
      expect(response.metadata.success).toBe(false);
      expect(response.metadata.error?.code).toBe('NOT_FOUND');
      expect(response.metadata.error?.message).toBe('User not found');
    });

    it('includes optional details', () => {
      const request: Request = {
        id: 'req-123',
        type: 'validation.request',
        payload: {},
        timestamp: Date.now(),
      };

      const details = { field: 'email', reason: 'Invalid format' };
      const response = errorResponse(request, 'VALIDATION_ERROR', 'Invalid input', details);

      expect(response.metadata.error?.details).toEqual(details);
    });

    it('transforms request type to response type', () => {
      const request: Request = {
        id: 'req-123',
        type: 'data.fetch.request',
        payload: {},
        timestamp: Date.now(),
      };

      const response = errorResponse(request, 'ERROR', 'Failed');

      expect(response.type).toBe('data.fetch.response');
    });

    it('includes request ID in metadata', () => {
      const request: Request = {
        id: 'req-error-456',
        type: 'test.request',
        payload: {},
        timestamp: Date.now(),
      };

      const response = errorResponse(request, 'ERROR', 'Failed');

      expect(response.metadata.requestId).toBe('req-error-456');
    });

    it('handles request type without .request suffix', () => {
      const request: Request = {
        id: 'req-123',
        type: 'custom.action',
        payload: {},
        timestamp: Date.now(),
      };

      const response = errorResponse(request, 'ERROR', 'Failed');

      // When no .request suffix, response type should remain unchanged
      expect(response.type).toBe('custom.action.response');
    });
  });
});
