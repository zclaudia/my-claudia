/**
 * Scheduled Tasks domain registration.
 *
 * Encapsulates all wiring needed to bootstrap the scheduled-tasks domain:
 * service creation, route mounting, system task registry, and scheduler.
 */

import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared';
import type { initDatabase } from '../../storage/db.js';
import { ScheduledTaskService } from './service.js';
import { createScheduledTaskRoutes } from './routes.js';
import { createSystemTaskRoutes } from '../../routes/system-tasks.js';
import { systemTaskRegistry } from '../../services/system-task-registry.js';
import { sendMessage } from '../conversation/ws/broadcast.js';
import type { ConnectedClient } from '../conversation/ws/types.js';

export interface ScheduledTaskDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  clients: Map<string, ConnectedClient>;
}

export interface ScheduledTaskDomainResult {
  scheduledTaskService: ScheduledTaskService;
}

export function registerScheduledTaskDomain(deps: ScheduledTaskDomainDeps): ScheduledTaskDomainResult {
  const { db, app, authMiddleware, clients } = deps;

  const scheduledTaskService = new ScheduledTaskService(db, (message: ServerMessage) => {
    clients.forEach((client) => {
      if (client.authenticated) sendMessage(client.ws, message);
    });
  });

  // Mount routes
  app.use('/api', authMiddleware, createScheduledTaskRoutes(scheduledTaskService));
  app.use('/api', authMiddleware, createSystemTaskRoutes(scheduledTaskService.getTaskRunRepo()));

  // Register and start scheduler
  systemTaskRegistry.register({
    id: 'system:scheduled_task_engine',
    name: 'Scheduled Task Engine',
    description: 'Checks for due tasks and executes them',
    category: 'scheduling',
    intervalMs: 10000,
  });
  setInterval(async () => {
    systemTaskRegistry.markRunStart('system:scheduled_task_engine');
    const start = Date.now();
    try {
      await scheduledTaskService.tick();
      systemTaskRegistry.markRunComplete('system:scheduled_task_engine', Date.now() - start);
    } catch (err) {
      systemTaskRegistry.markRunComplete('system:scheduled_task_engine', Date.now() - start, String(err));
      console.error('[ScheduledTasks] Tick error:', err);
    }
  }, 10000);

  return { scheduledTaskService };
}
