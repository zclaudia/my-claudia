// server/src/domains/meta-workflow/register.ts
import type { Database } from 'better-sqlite3';
import type { Router } from 'express';
import type { WorkflowEngine } from '../workflows/engine.js';
import type { WorkflowRunRepository } from '../workflows/workflow-run-repository.js';
import { MetaWorkflowService, type WorktreeAllocator } from './service.js';
import { createMetaWorkflowRoutes } from './routes.js';
import { createWorkflowRunEntity } from './run-entities/workflow-run-entity.js';
import {
  createSubagentRunEntity,
  createRunVirtualClientFromAiRunPort,
  type AiRunPort,
} from './run-entities/subagent-run-entity.js';

export interface RegisterMetaWorkflowOptions {
  db: Database;
  workflowEngine: WorkflowEngine;
  workflowRunRepository: WorkflowRunRepository;
  aiRunPort: AiRunPort;
  worktreeAllocator: WorktreeAllocator;
  defaultProjectId: string;
  defaultProviderId?: string;
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
  const runVirtualClient = createRunVirtualClientFromAiRunPort({
    aiRunPort: opts.aiRunPort,
    defaultProviderId: opts.defaultProviderId,
  });
  const runEntityForSubagent = createSubagentRunEntity({
    runVirtualClient,
  });

  const service = new MetaWorkflowService({
    db: opts.db,
    runEntityForWorkflow,
    runEntityForSubagent,
    worktreeAllocator: opts.worktreeAllocator,
    aiRunPort: opts.aiRunPort,
  });
  const routes = createMetaWorkflowRoutes(service);

  return { service, routes };
}
