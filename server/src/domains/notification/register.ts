import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { initDatabase } from '../../storage/db.js';
import type { ServerMessage } from '@my-claudia/shared';
import { createNotificationRoutes } from './routes.js';
import { createPushNotificationRoutes } from './notification-routes.js';
import { NotificationService } from './service.js';
import { PushNotificationService } from './notification-service.js';

export interface NotificationDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcastMessage: (message: ServerMessage) => void;
  setPushNotificationService: (service: PushNotificationService) => void;
}

export interface NotificationDomainResult {
  pushNotificationService: PushNotificationService;
  notificationService: NotificationService;
}

export function registerNotificationDomain(
  deps: NotificationDomainDeps,
): NotificationDomainResult {
  const { db, app, authMiddleware, broadcastMessage, setPushNotificationService } = deps;

  const pushNotificationService = new PushNotificationService(db);
  setPushNotificationService(pushNotificationService);

  const notificationService = new NotificationService({
    db,
    broadcastFn: broadcastMessage,
    notifyFn: (item) => {
      void pushNotificationService.notify({
        type: item.status === 'failed' ? 'run_failed' : 'run_completed',
        title: item.title,
        body: item.summary || item.error || '',
        tags: ['agent', 'feed'],
      });
    },
  });

  app.use('/api/notifications', authMiddleware, createNotificationRoutes(notificationService));
  app.use('/api/notifications', authMiddleware, createPushNotificationRoutes(pushNotificationService));

  return {
    pushNotificationService,
    notificationService,
  };
}
