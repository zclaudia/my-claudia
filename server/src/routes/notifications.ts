import { Router, Request, Response } from 'express';
import type { NotificationService } from '../services/notification-service.js';
import type { NotificationConfig } from '@my-claudia/shared';

const NOTIFICATION_EVENT_KEYS: Array<keyof NotificationConfig['events']> = [
  'permissionRequest',
  'askUserQuestion',
  'runCompleted',
  'runFailed',
  'supervisionUpdate',
  'backgroundPermission',
  'processLeak',
];

export function parseNotificationConfig(input: unknown): NotificationConfig | null {
  if (!input || typeof input !== 'object') return null;

  const candidate = input as Record<string, unknown>;
  if (typeof candidate.enabled !== 'boolean') return null;
  if (typeof candidate.ntfyUrl !== 'string') return null;
  if (typeof candidate.ntfyTopic !== 'string') return null;
  if (!candidate.events || typeof candidate.events !== 'object' || Array.isArray(candidate.events)) return null;

  const events = candidate.events as Record<string, unknown>;
  for (const key of NOTIFICATION_EVENT_KEYS) {
    if (typeof events[key] !== 'boolean') return null;
  }

  return {
    enabled: candidate.enabled,
    ntfyUrl: candidate.ntfyUrl,
    ntfyTopic: candidate.ntfyTopic,
    events: {
      permissionRequest: events.permissionRequest as boolean,
      askUserQuestion: events.askUserQuestion as boolean,
      runCompleted: events.runCompleted as boolean,
      runFailed: events.runFailed as boolean,
      supervisionUpdate: events.supervisionUpdate as boolean,
      backgroundPermission: events.backgroundPermission as boolean,
      processLeak: events.processLeak as boolean,
    },
  };
}

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
      const config = parseNotificationConfig(req.body);

      if (!config) {
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
