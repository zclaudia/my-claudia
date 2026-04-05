import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { createSessionRoutes } from './routes.js';
import { createSessionDraftRoutes } from './drafts-routes.js';
import type { ActiveRun } from '../conversation/ws/types.js';

type ActiveRunsMap = Map<string, ActiveRun>;

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
