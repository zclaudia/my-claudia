/**
 * Supervision domain registration.
 *
 * Encapsulates all wiring needed to bootstrap the supervision domain:
 * service creation, state recovery, checkpoint engine, route mounting, and polling.
 */

import type { Express, RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { SupervisorService } from './supervisor-service.js';
import { StateRecovery } from './state-recovery.js';
import { CheckpointEngine } from './checkpoint-engine.js';
import { ContextManager } from './context-manager.js';
import { SupervisionTaskRepository } from '../../infrastructure/repositories/supervision-task.js';
import { ProjectRepository } from '../projects/repository.js';
import { SessionRepository } from '../sessions/repository.js';
import { createSupervisionRoutes } from './routes.js';
import type { SupervisionAiRunPort, SupervisionSchedulingPort } from './ports.js';
export interface SupervisionDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcast: (msg: ServerMessage) => void;
  activeRuns: Map<string, { runId: string; clientId: string }>;
  aiRunPort: SupervisionAiRunPort;
  systemTaskRegistry: SupervisionSchedulingPort;
}

export interface SupervisionDomainResult {
  supervisorService: SupervisorService;
}

export function registerSupervisionDomain(deps: SupervisionDomainDeps): SupervisionDomainResult {
  const { db, app, authMiddleware, broadcast, activeRuns, aiRunPort, systemTaskRegistry } = deps;

  // Repositories
  const taskRepo = new SupervisionTaskRepository(db);
  const projectRepo = new ProjectRepository(db);
  const sessionRepo = new SessionRepository(db);

  // SupervisorService
  const supervisorService = new SupervisorService(
    db, taskRepo, projectRepo, sessionRepo, broadcast, aiRunPort,
  );

  // Mount routes on both prefixes
  app.use('/api', authMiddleware, createSupervisionRoutes(supervisorService));
  app.use('/api/supervision', authMiddleware, createSupervisionRoutes(supervisorService));

  // State recovery — re-hydrate stuck tasks before starting polling
  const stateRecovery = new StateRecovery(
    db, taskRepo, sessionRepo, projectRepo, supervisorService, activeRuns,
  );
  const recoveryReport = stateRecovery.recover();
  if (recoveryReport.actions.length > 0) {
    console.log(`[StateRecovery] Recovered ${recoveryReport.actions.length} items on startup`);
  }

  // CheckpointEngine
  const checkpointEngine = new CheckpointEngine(
    db, taskRepo, projectRepo, sessionRepo,
    (projectId: string) => {
      const project = projectRepo.findById(projectId);
      if (!project?.rootPath) throw new Error(`Project ${projectId} has no rootPath`);
      return new ContextManager(project.rootPath);
    },
    broadcast,
    (projectId, event, detail, taskIdArg) => {
      const id = crypto.randomUUID();
      try {
        db.prepare(
          `INSERT INTO supervision_logs (id, project_id, task_id, event, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)`
        ).run(id, projectId, taskIdArg ?? null, event, detail ? JSON.stringify(detail) : null, Date.now());
      } catch { /* best effort */ }
    },
    (projectId, data) => supervisorService.createTask(projectId, data),
    aiRunPort,
  );
  supervisorService.setCheckpointEngine(checkpointEngine);

  // Start supervision polling
  supervisorService.start(5000, systemTaskRegistry);

  return { supervisorService };
}
