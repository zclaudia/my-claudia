import type { Express, RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { LocalIssueService, type LocalIssueLifecycleHooks } from './service.js';
import { createLocalIssueRoutes } from './routes.js';
import { registerOwnerGuard } from '../attachments/access-control.js';

export interface LocalIssueDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcast: (projectId: string, msg: ServerMessage) => void;
  /** Optional hooks consumed by other domains (e.g. attachments cascade delete). */
  hooks?: LocalIssueLifecycleHooks;
}

export interface LocalIssueDomainResult {
  localIssueService: LocalIssueService;
}

export function registerLocalIssueDomain(deps: LocalIssueDomainDeps): LocalIssueDomainResult {
  const { db, app, authMiddleware, broadcast, hooks } = deps;

  const localIssueService = new LocalIssueService(db, broadcast, hooks);

  // Owner-existence guard for the attachments domain — refuses to attach
  // anything to an issue that has been deleted (or never existed).
  registerOwnerGuard('local_issue', (ownerId) => localIssueService.issueExists(ownerId));

  app.use('/api', authMiddleware, createLocalIssueRoutes(localIssueService));

  return { localIssueService };
}
