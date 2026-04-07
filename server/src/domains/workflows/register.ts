/**
 * Workflow domain registration.
 *
 * Assembles step executors (DI), wires engine + service, mounts routes, starts scheduler.
 */

import type { Express } from 'express';
import type { RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { WorkflowEngine } from './engine.js';
import { WorkflowService } from './service.js';
import { WorkflowGeneratorService } from './generator.js';
import { createWorkflowRoutes } from './routes.js';
import type { PushNotificationService } from '../../infrastructure/push/push-notification-service.js';
import type { SystemTaskRegistryPort } from '../../services/system-task-registry.js';

import {
  CompositeStepExecutor,
  ShellStepExecutor,
  WebhookStepExecutor,
  NotifyStepExecutor,
  ConditionStepExecutor,
  WaitStepExecutor,
  AIPromptStepExecutor,
  AIReviewStepExecutor,
  GitStepExecutor,
  PluginStepExecutor,
} from './step-executors/index.js';
import { VirtualClientAIRunner } from './step-executors/virtual-client-ai-runner.js';

/** Minimal port for plugin step registry — avoids direct application/ import */
type WorkflowStepRegistryPort = import('./step-executors/plugin-executor.js').PluginStepRegistry & {
  getAllMeta(): Array<{ type: string; name: string; description: string; category: string; icon?: string; configSchema?: unknown }>;
};

/** Minimal port for plugin trigger registry */
interface WorkflowTriggerRegistryPort {
  getAll(): Array<unknown>;
}

export interface WorkflowDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcast: (projectId: string | undefined, msg: ServerMessage | { type: string; [key: string]: unknown }) => void;
  notificationService: PushNotificationService;
  workflowStepRegistry: WorkflowStepRegistryPort;
  workflowTriggerRegistry?: WorkflowTriggerRegistryPort;
  systemTaskRegistry: SystemTaskRegistryPort;
}

export interface WorkflowDomainResult {
  workflowService: WorkflowService;
  workflowGeneratorService: WorkflowGeneratorService;
}

export function registerWorkflowDomain(deps: WorkflowDomainDeps): WorkflowDomainResult {
  const { db, app, authMiddleware, broadcast, notificationService, workflowStepRegistry, workflowTriggerRegistry, systemTaskRegistry } = deps;

  // -- Assemble step executors --
  const aiRunner = new VirtualClientAIRunner(db);
  const composite = new CompositeStepExecutor();

  composite.register(new ShellStepExecutor());
  composite.register(new WebhookStepExecutor());
  composite.register(new NotifyStepExecutor(notificationService));
  composite.register(new ConditionStepExecutor());
  composite.register(new AIPromptStepExecutor(aiRunner));
  composite.register(new AIReviewStepExecutor(aiRunner));
  composite.register(new GitStepExecutor());
  composite.registerPlugin(new PluginStepExecutor(workflowStepRegistry));

  // -- Build engine --
  const engine = new WorkflowEngine(db, broadcast, composite);

  // WaitStepExecutor needs the engine (which implements ApprovalPort)
  composite.register(new WaitStepExecutor(engine));

  // -- Build service --
  const workflowService = new WorkflowService(db, broadcast, engine);
  workflowService.initialize();

  const workflowGeneratorService = new WorkflowGeneratorService(db, workflowStepRegistry);

  // -- Mount routes --
  app.use('/api', authMiddleware, createWorkflowRoutes(workflowService, workflowGeneratorService, {
    stepRegistry: workflowStepRegistry,
    triggerRegistry: workflowTriggerRegistry,
  }));

  // -- Scheduler --
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
