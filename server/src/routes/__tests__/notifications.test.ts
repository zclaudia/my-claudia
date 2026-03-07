import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createNotificationRoutes } from '../notifications.js';
import type { NotificationService } from '../../services/notification-service.js';
import { DEFAULT_NOTIFICATION_CONFIG } from '@my-claudia/shared';

// Create mock notification service
const mockNotificationService = {
  getConfig: vi.fn(),
  saveConfig: vi.fn(),
  sendTest: vi.fn(),
  notify: vi.fn(),
};

describe('routes/notifications', () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/notifications', createNotificationRoutes(mockNotificationService as unknown as NotificationService));
  });

  describe('GET /api/notifications/config', () => {
    it('returns current config', async () => {
      const config = { ...DEFAULT_NOTIFICATION_CONFIG, ntfyTopic: 'test-topic' };
      mockNotificationService.getConfig.mockReturnValue(config);

      const response = await request(app).get('/api/notifications/config');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.ntfyTopic).toBe('test-topic');
    });

    it('handles errors', async () => {
      mockNotificationService.getConfig.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app).get('/api/notifications/config');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(response.body.error.message).toBe('Database error');
    });
  });

  describe('PUT /api/notifications/config', () => {
    it('saves valid config', async () => {
      const config = {
        ...DEFAULT_NOTIFICATION_CONFIG,
        enabled: true,
        ntfyTopic: 'new-topic',
      };

      const response = await request(app)
        .put('/api/notifications/config')
        .send(config);

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(mockNotificationService.saveConfig).toHaveBeenCalledWith(config);
    });

    it('rejects config without enabled field', async () => {
      const response = await request(app)
        .put('/api/notifications/config')
        .send({ ntfyTopic: 'test' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    });

    it('rejects config with non-boolean enabled', async () => {
      const response = await request(app)
        .put('/api/notifications/config')
        .send({ enabled: 'true' });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
    });

    it('rejects null config', async () => {
      const response = await request(app)
        .put('/api/notifications/config')
        .send(null);

      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe('INVALID_INPUT');
    });

    it('handles save errors', async () => {
      mockNotificationService.saveConfig.mockImplementation(() => {
        throw new Error('Save failed');
      });

      const response = await request(app)
        .put('/api/notifications/config')
        .send({ ...DEFAULT_NOTIFICATION_CONFIG, enabled: true });

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error.message).toBe('Save failed');
    });
  });

  describe('POST /api/notifications/test', () => {
    it('sends test notification', async () => {
      mockNotificationService.sendTest.mockResolvedValue(undefined);

      const response = await request(app).post('/api/notifications/test');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.message).toBe('Test notification sent');
    });

    it('returns error when sendTest fails', async () => {
      mockNotificationService.sendTest.mockRejectedValue(new Error('ntfy topic is not configured'));

      const response = await request(app).post('/api/notifications/test');

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error.code).toBe('NOTIFICATION_FAILED');
      expect(response.body.error.message).toBe('ntfy topic is not configured');
    });

    it('handles unknown errors', async () => {
      mockNotificationService.sendTest.mockRejectedValue('Unknown error string');

      const response = await request(app).post('/api/notifications/test');

      expect(response.status).toBe(400);
      expect(response.body.error.message).toBe('Failed to send test notification');
    });
  });
});
