import type { Express, RequestHandler } from 'express';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { TurnSummaryService } from './service.js';
import { createTurnSummaryRoutes } from './routes.js';

export interface TurnSummaryDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
}

export interface TurnSummaryDomainResult {
  turnSummaryService: TurnSummaryService;
}

export function registerTurnSummaryDomain(deps: TurnSummaryDomainDeps): TurnSummaryDomainResult {
  const { db, app, authMiddleware } = deps;
  const turnSummaryService = new TurnSummaryService(db);
  app.use('/api', authMiddleware, createTurnSummaryRoutes(turnSummaryService));
  return { turnSummaryService };
}
