import type { Express, RequestHandler } from 'express';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { createProjectRoutes, type ProjectChangeEvent } from './routes.js';

export interface ProjectsDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  onProjectChanged?: (event?: ProjectChangeEvent) => void;
}

export function registerProjectsDomain(deps: ProjectsDomainDeps): void {
  const { db, app, authMiddleware, onProjectChanged } = deps;
  app.use('/api/projects', authMiddleware, createProjectRoutes(db, onProjectChanged));
}
