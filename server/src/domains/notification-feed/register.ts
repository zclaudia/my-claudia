import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import { createNotificationRoutes } from './routes.js';
import { NotificationService } from './service.js';
import type { NotificationSender } from '../../infrastructure/push/notification-sender.js';
import { buildAppSelectionClickUrl, formatSessionBackendContext, getBackendDisplayName } from '../../infrastructure/push/notification-context.js';

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
      const context = item.sessionId
        ? `${formatSessionBackendContext(db, item.sessionId)}. `
        : `Backend ${getBackendDisplayName(db)}. `;
      void notificationSender.notify({
        type: item.status === 'failed' ? 'run_failed' : 'run_completed',
        title: item.title,
        body: `${context}${item.summary || item.error || ''}`.trim(),
        tags: ['agent', 'feed'],
        clickUrl: buildAppSelectionClickUrl(db, {
          backendId: item.ownerBackendId,
          projectId: item.projectId,
          sessionId: item.sessionId,
        }),
      });
    },
  });

  app.use('/api/notifications', authMiddleware, createNotificationRoutes(notificationService));

  return {
    notificationService,
  };
}
