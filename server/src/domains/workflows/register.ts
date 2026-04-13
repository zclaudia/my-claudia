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
import type { NotificationSender } from '../../infrastructure/push/notification-sender.js';
import type { WorkflowAiRunPort, WorkflowSchedulingPort } from './ports/runtime.js';

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
  PermissionClassifyStepExecutor,
  AIRiskAnalysisStepExecutor,
  PermissionDecideStepExecutor,
} from './step-executors/index.js';
import type { PermissionBridgePort, AIRiskAnalysisPort } from './ports/step-executor.js';
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
  notificationService: NotificationSender;
  workflowStepRegistry: WorkflowStepRegistryPort;
  workflowTriggerRegistry?: WorkflowTriggerRegistryPort;
  systemTaskRegistry: WorkflowSchedulingPort;
  aiRunPort: WorkflowAiRunPort;
  permissionBridge?: PermissionBridgePort;
  aiRiskAnalysisPort?: AIRiskAnalysisPort;
}

export interface WorkflowDomainResult {
  workflowService: WorkflowService;
  workflowGeneratorService: WorkflowGeneratorService;
  workflowEngine: WorkflowEngine;
}

export function registerWorkflowDomain(deps: WorkflowDomainDeps): WorkflowDomainResult {
  const { db, app, authMiddleware, broadcast, notificationService, workflowStepRegistry, workflowTriggerRegistry, systemTaskRegistry, aiRunPort, permissionBridge, aiRiskAnalysisPort } = deps;

  // -- Assemble step executors --
  const aiRunner = new VirtualClientAIRunner(db, aiRunPort);
  const composite = new CompositeStepExecutor();

  composite.register(new ShellStepExecutor());
  composite.register(new WebhookStepExecutor());
  composite.register(new NotifyStepExecutor(notificationService));
  composite.register(new ConditionStepExecutor());
  composite.register(new AIPromptStepExecutor(aiRunner));
  composite.register(new AIReviewStepExecutor(aiRunner));
  composite.register(new GitStepExecutor());
  composite.registerPlugin(new PluginStepExecutor(workflowStepRegistry));

  // -- Permission workflow step executors --
  composite.register(new PermissionClassifyStepExecutor());
  if (permissionBridge) {
    composite.register(new PermissionDecideStepExecutor(permissionBridge));
  }
  if (aiRiskAnalysisPort) {
    composite.register(new AIRiskAnalysisStepExecutor(aiRiskAnalysisPort));
  }

  // -- Build engine --
  const engine = new WorkflowEngine(db, broadcast, composite);

  // WaitStepExecutor needs the engine (which implements ApprovalPort)
  composite.register(new WaitStepExecutor(engine));

  // -- Build service --
  const workflowService = new WorkflowService(db, broadcast, engine);
  workflowService.initialize();

  const workflowGeneratorService = new WorkflowGeneratorService(db, workflowStepRegistry, aiRunPort);

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

  return { workflowService, workflowGeneratorService, workflowEngine: engine };
}
