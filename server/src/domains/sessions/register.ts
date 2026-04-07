import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { createSessionRoutes } from './routes.js';
import { createSessionDraftRoutes } from './drafts-routes.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- sessions domain treats this as opaque; concrete type lives in application/conversation
type ActiveRunsMap = Map<string, any>;

export interface SessionsDomainDeps {
  app: Express;
  authMiddleware: RequestHandler;
  db: Database.Database;
  activeRuns: ActiveRunsMap;
}

export function registerSessionsDomain(deps: SessionsDomainDeps): void {
  const { app, authMiddleware, db, activeRuns } = deps;

  app.use('/api/sessions', authMiddleware, createSessionRoutes(db, activeRuns));
  app.use('/api/sessions', authMiddleware, createSessionDraftRoutes(db));
}
