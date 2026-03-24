/**
 * Workflow domain registration.
 *
 * Encapsulates all wiring needed to bootstrap the workflow domain:
 * service creation, initialization, generator service, route mounting, and scheduler.
 */

import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared';
import type { initDatabase } from '../../storage/db.js';
import { WorkflowService } from './service.js';
import { WorkflowGeneratorService } from './generator.js';
import { createWorkflowRoutes } from './routes.js';
import { systemTaskRegistry } from '../../services/system-task-registry.js';
import { sendMessage } from '../../ws/broadcast.js';
import type { ConnectedClient } from '../../ws/types.js';
import type { NotificationService } from '../../services/notification-service.js';

export interface WorkflowDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  clients: Map<string, ConnectedClient>;
  notificationService: NotificationService;
}

export interface WorkflowDomainResult {
  workflowService: WorkflowService;
  workflowGeneratorService: WorkflowGeneratorService;
}

export function registerWorkflowDomain(deps: WorkflowDomainDeps): WorkflowDomainResult {
  const { db, app, authMiddleware, clients, notificationService } = deps;

  const broadcast = (projectId: string | undefined, message: any) => {
    clients.forEach((client) => {
      if (client.authenticated) sendMessage(client.ws, message);
    });
  };

  const workflowService = new WorkflowService(db, broadcast, notificationService);
  workflowService.initialize();

  const workflowGeneratorService = new WorkflowGeneratorService(db);

  // Mount routes
  app.use('/api', authMiddleware, createWorkflowRoutes(workflowService, workflowGeneratorService));

  // Register and start scheduler
  systemTaskRegistry.register({
    id: 'system:workflow_scheduler',
    name: 'Workflow Scheduler',
    description: 'Checks for due workflow schedules and starts runs',
    category: 'scheduling',
    intervalMs: 10000,
  });
  setInterval(async () => {
    systemTaskRegistry.markRunStart('system:workflow_scheduler');
    const start = Date.now();
    try {
      await workflowService.tick();
      systemTaskRegistry.markRunComplete('system:workflow_scheduler', Date.now() - start);
    } catch (err) {
      systemTaskRegistry.markRunComplete('system:workflow_scheduler', Date.now() - start, String(err));
      console.error('[Workflow] Tick error:', err);
    }
  }, 10000);

  return { workflowService, workflowGeneratorService };
}
