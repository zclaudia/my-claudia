/**
 * Supervision domain registration.
 *
 * Encapsulates all wiring needed to bootstrap the supervision domain:
 * service creation, state recovery, checkpoint engine, route mounting, and polling.
 */

import type { Express, RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared';
import type { initDatabase } from '../../storage/db.js';
import { SupervisorService } from '../../services/supervision/supervisor-service.js';
import { StateRecovery } from '../../services/supervision/state-recovery.js';
import { CheckpointEngine } from '../../services/supervision/checkpoint-engine.js';
import { ContextManager } from '../../services/supervision/context-manager.js';
import { SupervisionTaskRepository } from '../../repositories/supervision-task.js';
import { ProjectRepository } from '../../repositories/project.js';
import { SessionRepository } from '../../repositories/session.js';
import { createSupervisionRoutes } from './routes.js';
import { sendMessage } from '../../ws/broadcast.js';
import { createVirtualClient } from '../../ws/types.js';
import type { ConnectedClient, ActiveRun } from '../../ws/types.js';

export interface SupervisionDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  clients: Map<string, ConnectedClient>;
  activeRuns: Map<string, ActiveRun>;
  handleRunStart: (...args: any[]) => Promise<void>;
}

export interface SupervisionDomainResult {
  supervisorService: SupervisorService;
}

export function registerSupervisionDomain(deps: SupervisionDomainDeps): SupervisionDomainResult {
  const { db, app, authMiddleware, clients, activeRuns, handleRunStart } = deps;

  // Repositories
  const taskRepo = new SupervisionTaskRepository(db);
  const projectRepo = new ProjectRepository(db);
  const sessionRepo = new SessionRepository(db);

  // Broadcast helper
  const broadcast = (msg: ServerMessage) => {
    clients.forEach((client) => {
      if (client.authenticated) {
        sendMessage(client.ws, msg);
      }
    });
  };

  // SupervisorService
  const supervisorService = new SupervisorService(
    db, taskRepo, projectRepo, sessionRepo, broadcast,
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
    createVirtualClient,
    handleRunStart as any,
  );
  supervisorService.setCheckpointEngine(checkpointEngine);

  // Start supervision polling
  supervisorService.start(5000);

  return { supervisorService };
}
