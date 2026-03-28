import { Router, Request, Response } from 'express';
import type { NotificationFeedService } from './service.js';

export function createNotificationFeedRoutes(notificationService: NotificationFeedService): Router {
  const router = Router();

  // GET /api/notifications — List notification items (paginated)
  router.get('/', (req: Request, res: Response) => {
    try {
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
      const before = req.query.before ? parseInt(req.query.before as string, 10) : undefined;
      const unreadOnly = req.query.unreadOnly === 'true';

      const result = notificationService.listItems({ limit, before, unreadOnly });
      res.json({ success: true, data: result });
    } catch (error) {
      console.error('Error listing notifications:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to list notifications' } });
    }
  });

  // POST /api/notifications/mark-read — Mark items as read
  router.post('/mark-read', (req: Request, res: Response) => {
    try {
      const { itemIds } = req.body;
      if (!Array.isArray(itemIds)) {
        res.status(400).json({ success: false, error: { code: 'INVALID_INPUT', message: 'itemIds must be an array' } });
        return;
      }
      notificationService.markRead(itemIds);
      res.json({ success: true });
    } catch (error) {
      console.error('Error marking notifications read:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to mark read' } });
    }
  });

  // GET /api/notifications/unread-count — Get unread count
  router.get('/unread-count', (_req: Request, res: Response) => {
    try {
      const count = notificationService.getUnreadCount();
      res.json({ success: true, data: { count } });
    } catch (error) {
      console.error('Error getting unread count:', error);
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get unread count' } });
    }
  });

  return router;
}
