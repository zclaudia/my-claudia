// server/src/domains/meta-workflow/run-entities/workflow-run-entity.ts
import type { WorkflowEngine } from '../../workflows/engine.js';
import type { WorkflowRunRepository } from '../../workflows/workflow-run-repository.js';
import type { WorkflowRun } from '@my-claudia/shared/features/workflows';
import type {
  RunEntity,
  SynthesizedEntity,
  RunEntityOutcome,
} from '../phase-executor.js';

export interface CreateWorkflowRunEntityOptions {
  engine: WorkflowEngine;
  runRepo: WorkflowRunRepository;
  projectId: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_MS = 200;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;

function isTerminal(run: WorkflowRun): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status);
}

export function createWorkflowRunEntity(opts: CreateWorkflowRunEntityOptions): RunEntity {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (entity: SynthesizedEntity, _ctx): Promise<RunEntityOutcome> => {
    if (entity.kind !== 'workflow') {
      throw new Error(`workflow run-entity received non-workflow kind: ${entity.kind}`);
    }

    // Real engine.startRun signature:
    //   startRun(workflowId, projectId, definition, triggerSource, triggerDetail?, triggerData?)
    // The plan's conceptual sketch had a different argument order; we adapt here (not in the engine).
    const run = await opts.engine.startRun(
      entity.workflowId,
      opts.projectId,
      entity.workflow,
      'manual',
    );

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const fresh = opts.runRepo.findById(run.id);
      if (fresh && isTerminal(fresh)) {
        return { exitOk: fresh.status === 'completed' };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return { exitOk: false };
  };
}
