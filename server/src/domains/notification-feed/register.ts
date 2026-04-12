import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import { createNotificationRoutes } from './routes.js';
import { NotificationService } from './service.js';
import type { NotificationSender } from '../../infrastructure/push/notification-sender.js';

export interface NotificationDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcastMessage: (message: ServerMessage) => void;
  notificationSender: NotificationSender;
}

export interface NotificationDomainResult {
  notificationService: NotificationService;
}

export function registerNotificationDomain(
  deps: NotificationDomainDeps,
): NotificationDomainResult {
  const { db, app, authMiddleware, broadcastMessage, notificationSender } = deps;

  const notificationService = new NotificationService({
    db,
    broadcastFn: broadcastMessage,
    notifyFn: (item) => {
      void notificationSender.notify({
        type: item.status === 'failed' ? 'run_failed' : 'run_completed',
        title: item.title,
        body: item.summary || item.error || '',
        tags: ['agent', 'feed'],
      });
    },
  });

  app.use('/api/notifications', authMiddleware, createNotificationRoutes(notificationService));

  return {
    notificationService,
  };
}
