import type { Express, RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { AttachmentService } from './service.js';
import { createAttachmentRoutes } from './routes.js';

export interface AttachmentDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  /**
   * Broadcast helper. The attachments domain only emits owner-scoped messages
   * (`attachment_added` / `attachment_removed`); routing to project rooms is
   * left to the consumer that already understands ownership.
   */
  broadcast: (message: ServerMessage) => void;
}

export interface AttachmentDomainResult {
  attachmentService: AttachmentService;
}

export function registerAttachmentDomain(deps: AttachmentDomainDeps): AttachmentDomainResult {
  const { db, app, authMiddleware, broadcast } = deps;

  const attachmentService = new AttachmentService(db, broadcast);
  app.use('/api', authMiddleware, createAttachmentRoutes(attachmentService));

  return { attachmentService };
}
