import type { Express, RequestHandler } from 'express';
import type Database from 'better-sqlite3';
import { createProviderRoutes } from './routes.js';

export interface ProvidersDomainDeps {
  app: Express;
  authMiddleware: RequestHandler;
  db: Database.Database;
  toolRegistry?: { getDefinitionsBySource(source: string): unknown[] };
}

export function registerProvidersDomain(deps: ProvidersDomainDeps): void {
  const { app, authMiddleware, db, toolRegistry } = deps;

  app.use('/api/providers', authMiddleware, createProviderRoutes(db, toolRegistry));
}
