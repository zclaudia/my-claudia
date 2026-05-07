import type { Express, RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { LocalIssueService } from './service.js';
import { createLocalIssueRoutes } from './routes.js';

export interface LocalIssueDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcast: (projectId: string, msg: ServerMessage) => void;
}

export interface LocalIssueDomainResult {
  localIssueService: LocalIssueService;
}

export function registerLocalIssueDomain(deps: LocalIssueDomainDeps): LocalIssueDomainResult {
  const { db, app, authMiddleware, broadcast } = deps;

  const localIssueService = new LocalIssueService(db, broadcast);

  app.use('/api', authMiddleware, createLocalIssueRoutes(localIssueService));

  return { localIssueService };
}
