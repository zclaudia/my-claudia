// server/src/domains/meta-workflow/register.ts
import type { Database } from 'better-sqlite3';
import type { Router } from 'express';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { WorkflowRunRepository } from '../workflows/workflow-run-repository.js';
import { MetaWorkflowService } from './service.js';
import { createMetaWorkflowRoutes } from './routes.js';
import { createWorkflowRunEntity } from './run-entities/workflow-run-entity.js';
import {
  createSubagentRunEntity,
  type RunVirtualClient,
} from './run-entities/subagent-run-entity.js';

export interface RegisterMetaWorkflowOptions {
  db: Database;
  workflowEngine: WorkflowEngine;
  workflowRunRepository: WorkflowRunRepository;
  runVirtualClient: RunVirtualClient;
  /**
   * Project to bind every workflow run to. For per-run project context the
   * service should accept this at call time; for Phase C MVP a single
   * default is used and overridden by `runPhase`'s implicit context.
   */
  defaultProjectId: string;
}

export interface RegisteredMetaWorkflow {
  service: MetaWorkflowService;
  routes: Router;
}

export function registerMetaWorkflow(opts: RegisterMetaWorkflowOptions): RegisteredMetaWorkflow {
  const runEntityForWorkflow = createWorkflowRunEntity({
    engine: opts.workflowEngine,
    runRepo: opts.workflowRunRepository,
    projectId: opts.defaultProjectId,
  });
  const runEntityForSubagent = createSubagentRunEntity({
    runVirtualClient: opts.runVirtualClient,
  });

  const service = new MetaWorkflowService({
    db: opts.db,
    runEntityForWorkflow,
    runEntityForSubagent,
  });
  const routes = createMetaWorkflowRoutes(service);

  return { service, routes };
}
