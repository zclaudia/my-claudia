import { Router, Request, Response } from 'express';
import type { NotificationService } from '../services/notification-service.js';
import type { NotificationConfig } from '@my-claudia/shared';

export function createNotificationRoutes(notificationService: NotificationService): Router {
  const router = Router();

  // GET /api/notifications/config
  router.get('/config', (_req: Request, res: Response) => {
    try {
      const config = notificationService.getConfig();
      res.json({ success: true, data: config });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }
      });
    }
  });

  // PUT /api/notifications/config
  router.put('/config', (req: Request, res: Response) => {
    try {
      const config = req.body as NotificationConfig;

      if (!config || typeof config.enabled !== 'boolean') {
        res.status(400).json({
          success: false,
          error: { code: 'INVALID_INPUT', message: 'Invalid notification config' }
        });
        return;
      }

      notificationService.saveConfig(config);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({
        success: false,
        error: { code: 'INTERNAL_ERROR', message: err instanceof Error ? err.message : 'Unknown error' }
      });
    }
  });

  // POST /api/notifications/test
  router.post('/test', async (_req: Request, res: Response) => {
    try {
      await notificationService.sendTest();
      res.json({ success: true, data: { message: 'Test notification sent' } });
    } catch (err) {
      res.status(400).json({
        success: false,
        error: { code: 'NOTIFICATION_FAILED', message: err instanceof Error ? err.message : 'Failed to send test notification' }
      });
    }
  });

  return router;
}
