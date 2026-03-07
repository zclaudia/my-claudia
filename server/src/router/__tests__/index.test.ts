import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MessageRouter, createRouter } from '../index.js';
import type { MessageContext, MessageHandler, Middleware } from '../../middleware/base.js';
import type { Request } from '@my-claudia/shared';
import type { Repository } from '../../repositories/base.js';

// Helper to create a mock request
function mockRequest(type: string, payload: any = {}): Request {
  return {
    id: 'req-1',
    type,
    payload,
    timestamp: Date.now(),
    metadata: { timeout: 30000 },
  };
}

// Helper to create a mock connected client
function mockClient() {
  return { id: 'client-1', ws: {}, authenticated: true, isLocal: true };
}

// Helper to create a mock database
function mockDb() {
  return {} as any;
}

describe('MessageRouter', () => {
  let router: MessageRouter;

  beforeEach(() => {
    router = new MessageRouter(mockDb());
  });

  describe('register', () => {
    it('registers a handler for a message type', () => {
      const handler: MessageHandler = vi.fn().mockResolvedValue(undefined);
      router.register('test_action', handler);

      expect(router.hasRoute('test_action')).toBe(true);
    });

    it('overwrites existing handler for same message type', () => {
      const handler1: MessageHandler = vi.fn();
      const handler2: MessageHandler = vi.fn();

      router.register('test_action', handler1);
      router.register('test_action', handler2);

      expect(router.hasRoute('test_action')).toBe(true);
      // Only one route should exist
      expect(router.getRoutes()).toEqual(['test_action']);
    });
  });

  describe('route', () => {
    it('routes a request to the registered handler', async () => {
      const response = {
        id: 'resp-1',
        type: 'test_result',
        payload: { data: 'ok' },
        timestamp: Date.now(),
        metadata: { requestId: 'req-1', success: true },
      };
      const handler: MessageHandler = vi.fn().mockResolvedValue(response);

      router.register('test_action', handler);
      const result = await router.route(mockClient(), mockRequest('test_action'));

      expect(handler).toHaveBeenCalled();
      expect(result).toEqual(response);
    });

    it('returns undefined when no route matches', async () => {
      const result = await router.route(mockClient(), mockRequest('unknown_action'));

      expect(result).toBeUndefined();
    });

    it('passes correct MessageContext to handler', async () => {
      let capturedCtx: MessageContext | undefined;
      const handler: MessageHandler = vi.fn().mockImplementation(async (ctx) => {
        capturedCtx = ctx;
        return undefined;
      });

      const client = mockClient();
      const request = mockRequest('test_action', { key: 'value' });

      router.register('test_action', handler);
      await router.route(client, request);

      expect(capturedCtx).toBeDefined();
      expect(capturedCtx!.client).toBe(client);
      expect(capturedCtx!.request).toBe(request);
      expect(capturedCtx!.metadata).toBeInstanceOf(Map);
    });

    it('returns error response on unhandled handler error', async () => {
      const handler: MessageHandler = vi.fn().mockRejectedValue(new Error('Handler crashed'));

      router.register('test_action', handler);

      // Suppress console.error for this test
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await router.route(mockClient(), mockRequest('test_action'));

      expect(result).toBeDefined();
      expect(result!.metadata.success).toBe(false);
      expect(result!.metadata.error?.message).toBe('Handler crashed');

      consoleSpy.mockRestore();
    });

    it('returns error response with "Unknown error" for non-Error throws', async () => {
      const handler: MessageHandler = vi.fn().mockRejectedValue('string error');

      router.register('test_action', handler);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await router.route(mockClient(), mockRequest('test_action'));

      expect(result).toBeDefined();
      expect(result!.metadata.success).toBe(false);
      expect(result!.metadata.error?.message).toBe('Unknown error');

      consoleSpy.mockRestore();
    });
  });

  describe('use (global middleware)', () => {
    it('applies global middleware to registered handlers', async () => {
      const callOrder: string[] = [];

      const middleware: Middleware = async (ctx, next) => {
        callOrder.push('middleware');
        return next(ctx);
      };

      const handler: MessageHandler = vi.fn().mockImplementation(async () => {
        callOrder.push('handler');
        return undefined;
      });

      router.use(middleware);
      router.register('test_action', handler);
      await router.route(mockClient(), mockRequest('test_action'));

      expect(callOrder).toEqual(['middleware', 'handler']);
    });

    it('applies multiple global middleware in order', async () => {
      const callOrder: string[] = [];

      const mw1: Middleware = async (ctx, next) => {
        callOrder.push('mw1');
        return next(ctx);
      };
      const mw2: Middleware = async (ctx, next) => {
        callOrder.push('mw2');
        return next(ctx);
      };

      const handler: MessageHandler = vi.fn().mockImplementation(async () => {
        callOrder.push('handler');
        return undefined;
      });

      router.use(mw1, mw2);
      router.register('test_action', handler);
      await router.route(mockClient(), mockRequest('test_action'));

      expect(callOrder).toEqual(['mw1', 'mw2', 'handler']);
    });

    it('allows middleware to short-circuit without calling next', async () => {
      const shortCircuitResponse = {
        id: 'resp-1',
        type: 'blocked',
        payload: null,
        timestamp: Date.now(),
        metadata: { requestId: 'req-1', success: false, error: { code: 'BLOCKED', message: 'Blocked' } },
      };

      const blockingMiddleware: Middleware = async (_ctx, _next) => {
        return shortCircuitResponse as any;
      };

      const handler: MessageHandler = vi.fn();

      router.use(blockingMiddleware);
      router.register('test_action', handler);
      const result = await router.route(mockClient(), mockRequest('test_action'));

      expect(result).toEqual(shortCircuitResponse);
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('register with route-specific middleware', () => {
    it('applies route-specific middleware in addition to global middleware', async () => {
      const callOrder: string[] = [];

      const globalMw: Middleware = async (ctx, next) => {
        callOrder.push('global');
        return next(ctx);
      };
      const routeMw: Middleware = async (ctx, next) => {
        callOrder.push('route');
        return next(ctx);
      };
      const handler: MessageHandler = vi.fn().mockImplementation(async () => {
        callOrder.push('handler');
        return undefined;
      });

      router.use(globalMw);
      router.register('test_action', handler, { middleware: [routeMw] });
      await router.route(mockClient(), mockRequest('test_action'));

      expect(callOrder).toEqual(['global', 'route', 'handler']);
    });
  });

  describe('crud', () => {
    it('registers 4 CRUD routes with default message types', () => {
      const repo: Repository<any, any, any> = {
        findAll: vi.fn().mockReturnValue([]),
        findById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      // Suppress console.log from crud registration
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      router.crud('projects', repo);

      expect(router.hasRoute('get_projects')).toBe(true);
      expect(router.hasRoute('add_project')).toBe(true);
      expect(router.hasRoute('update_project')).toBe(true);
      expect(router.hasRoute('delete_project')).toBe(true);

      consoleSpy.mockRestore();
    });

    it('uses custom message types when provided', () => {
      const repo: Repository<any, any, any> = {
        findAll: vi.fn().mockReturnValue([]),
        findById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      router.crud('items', repo, {
        messageTypes: {
          list: 'fetch_items',
          create: 'new_item',
          update: 'modify_item',
          delete: 'remove_item',
        },
      });

      expect(router.hasRoute('fetch_items')).toBe(true);
      expect(router.hasRoute('new_item')).toBe(true);
      expect(router.hasRoute('modify_item')).toBe(true);
      expect(router.hasRoute('remove_item')).toBe(true);

      consoleSpy.mockRestore();
    });

    it('routes crud list action to repository.findAll', async () => {
      const items = [{ id: '1' }, { id: '2' }];
      const repo: Repository<any, any, any> = {
        findAll: vi.fn().mockReturnValue(items),
        findById: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      };

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      router.crud('projects', repo);
      const result = await router.route(mockClient(), mockRequest('get_projects'));

      expect(repo.findAll).toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result!.payload).toEqual({ projects: items });

      consoleSpy.mockRestore();
    });
  });

  describe('hasRoute', () => {
    it('returns true for registered routes', () => {
      router.register('action_a', vi.fn());
      expect(router.hasRoute('action_a')).toBe(true);
    });

    it('returns false for unregistered routes', () => {
      expect(router.hasRoute('nonexistent')).toBe(false);
    });
  });

  describe('getRoutes', () => {
    it('returns all registered route names', () => {
      router.register('action_a', vi.fn());
      router.register('action_b', vi.fn());
      router.register('action_c', vi.fn());

      const routes = router.getRoutes();
      expect(routes).toContain('action_a');
      expect(routes).toContain('action_b');
      expect(routes).toContain('action_c');
      expect(routes).toHaveLength(3);
    });

    it('returns empty array when no routes registered', () => {
      expect(router.getRoutes()).toEqual([]);
    });
  });

  describe('clear', () => {
    it('removes all registered routes', () => {
      router.register('action_a', vi.fn());
      router.register('action_b', vi.fn());

      expect(router.getRoutes()).toHaveLength(2);

      router.clear();

      expect(router.getRoutes()).toHaveLength(0);
      expect(router.hasRoute('action_a')).toBe(false);
    });
  });
});

describe('createRouter', () => {
  it('returns a MessageRouter instance', () => {
    const router = createRouter(mockDb());
    expect(router).toBeInstanceOf(MessageRouter);
  });
});
