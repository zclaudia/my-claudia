import { describe, it, expect, vi, beforeEach } from 'vitest';
import type express from 'express';
import { createPushNotificationRoutes, parseNotificationConfig } from '../notification-routes.js';
import type { PushNotificationService } from '../notification-service.js';
import { DEFAULT_NOTIFICATION_CONFIG } from '@my-claudia/shared';

// Create mock notification service
const mockNotificationService = {
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  sendTest: vi.fn(),
  notify: vi.fn(),
};

describe('routes/notifications', () => {
  let router: express.Router;

  beforeEach(() => {
    vi.clearAllMocks();
    router = createPushNotificationRoutes(mockNotificationService as unknown as PushNotificationService);
  });

  function findRouteHandler(method: 'get' | 'put' | 'post', path: string) {
    const layer = (router as any).stack.find(
      (entry: any) => entry.route?.path === path && entry.route?.methods?.[method]
    );
    const routeLayer = layer?.route?.stack.find((entry: any) => entry.method === method);
    if (!routeLayer) throw new Error(`Route ${method.toUpperCase()} ${path} not found`);
    return routeLayer.handle as (req: express.Request, res: express.Response) => unknown;
  }

  async function invokeRoute(
    method: 'get' | 'put' | 'post',
    path: string,
    options: { body?: unknown } = {},
  ): Promise<{ statusCode: number; body: unknown }> {
    const req = { body: options.body } as express.Request;
    const result: { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
    const res = {
      status(code: number) {
        result.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        result.body = payload;
        return this;
      },
    } as unknown as express.Response;

    await findRouteHandler(method, path)(req, res);
    return result;
  }

  describe('parseNotificationConfig', () => {
    it('accepts valid config', () => {
      expect(parseNotificationConfig(DEFAULT_NOTIFICATION_CONFIG)).toEqual(DEFAULT_NOTIFICATION_CONFIG);
    });

    it('rejects non-string ntfyUrl', () => {
      expect(parseNotificationConfig({
        ...DEFAULT_NOTIFICATION_CONFIG,
        ntfyUrl: 123,
      })).toBeNull();
    });

    it('rejects invalid nested event value', () => {
      expect(parseNotificationConfig({
        ...DEFAULT_NOTIFICATION_CONFIG,
        events: { ...DEFAULT_NOTIFICATION_CONFIG.events, processLeak: 'yes' },
      })).toBeNull();
    });
  });

  describe('GET /api/notifications/config', () => {
    it('returns current config', async () => {
      const config = { ...DEFAULT_NOTIFICATION_CONFIG, ntfyTopic: 'test-topic' };
      mockNotificationService.getConfig.mockReturnValue(config);

      const response = await invokeRoute('get', '/config');

      expect(response.statusCode).toBe(200);
      expect((response.body as any).success).toBe(true);
      expect((response.body as any).data.ntfyTopic).toBe('test-topic');
    });

    it('handles errors', async () => {
      mockNotificationService.getConfig.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await invokeRoute('get', '/config');

      expect(response.statusCode).toBe(500);
      expect((response.body as any).success).toBe(false);
      expect((response.body as any).error.code).toBe('INTERNAL_ERROR');
      expect((response.body as any).error.message).toBe('Database error');
    });
  });

  describe('PUT /api/notifications/config', () => {
    it('saves valid config', async () => {
      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        enabled: true,
        ntfyTopic: 'new-topic',
      };

      const response = await invokeRoute('put', '/config', { body: config });

      expect(response.statusCode).toBe(200);
      expect((response.body as any).success).toBe(true);
      expect(mockNotificationService.saveConfig).toHaveBeenCalledWith(config);
    });

    it('rejects config without enabled field', async () => {
      const response = await invokeRoute('put', '/config', { body: { ntfyTopic: 'test' } });

      expect(response.statusCode).toBe(400);
      expect((response.body as any).success).toBe(false);
      expect((response.body as any).error.code).toBe('INVALID_INPUT');
    });

    it('rejects config with non-boolean enabled', async () => {
      const response = await invokeRoute('put', '/config', { body: { enabled: 'true' } });

      expect(response.statusCode).toBe(400);
      expect((response.body as any).success).toBe(false);
    });

    it('rejects null config', async () => {
      const response = await invokeRoute('put', '/config', { body: null });

      expect(response.statusCode).toBe(400);
      expect((response.body as any).error.code).toBe('INVALID_INPUT');
    });

    it('rejects config with non-string ntfyUrl', async () => {
      const response = await invokeRoute('put', '/config', {
        body: { ...DEFAULT_NOTIFICATION_CONFIG, enabled: true, ntfyUrl: 123 },
      });

      expect(response.statusCode).toBe(400);
      expect((response.body as any).error.code).toBe('INVALID_INPUT');
    });

    it('rejects config with invalid nested event value', async () => {
      const response = await invokeRoute('put', '/config', {
        body: {
          ...DEFAULT_NOTIFICATION_CONFIG,
          enabled: true,
          events: {
            ...DEFAULT_NOTIFICATION_CONFIG.events,
            processLeak: 'yes',
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect((response.body as any).error.code).toBe('INVALID_INPUT');
    });

    it('handles save errors', async () => {
      mockNotificationService.saveConfig.mockImplementation(() => {
        throw new Error('Save failed');
      });

      const response = await invokeRoute('put', '/config', {
        body: { ...DEFAULT_NOTIFICATION_CONFIG, enabled: true },
      });

      expect(response.statusCode).toBe(500);
      expect((response.body as any).success).toBe(false);
      expect((response.body as any).error.message).toBe('Save failed');
    });
  });

  describe('POST /api/notifications/test', () => {
    it('sends test notification', async () => {
      mockNotificationService.sendTest.mockResolvedValue(undefined);

      const response = await invokeRoute('post', '/test');

      expect(response.statusCode).toBe(200);
      expect((response.body as any).success).toBe(true);
      expect((response.body as any).data.message).toBe('Test notification sent');
    });

    it('returns error when sendTest fails', async () => {
      mockNotificationService.sendTest.mockRejectedValue(new Error('ntfy topic is not configured'));

      const response = await invokeRoute('post', '/test');

      expect(response.statusCode).toBe(400);
      expect((response.body as any).success).toBe(false);
      expect((response.body as any).error.code).toBe('NOTIFICATION_FAILED');
      expect((response.body as any).error.message).toBe('ntfy topic is not configured');
    });

    it('handles unknown errors', async () => {
      mockNotificationService.sendTest.mockRejectedValue('Unknown error string');

      const response = await invokeRoute('post', '/test');

      expect(response.statusCode).toBe(400);
      expect((response.body as any).error.message).toBe('Failed to send test notification');
    });
  });
});
