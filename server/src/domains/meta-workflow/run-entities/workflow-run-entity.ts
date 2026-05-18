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
  /** Backup polling interval (event listener is primary). Defaults to 1 s. */
  pollIntervalMs?: number;
  timeoutMs?: number;
}

const DEFAULT_POLL_MS = 1000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;
const TERMINAL_EVENT_TYPES = new Set(['run_completed', 'run_failed', 'run_cancelled']);
const TERMINAL_RUN_STATUSES = ['completed', 'failed', 'cancelled'] as const;

function isTerminalRun(run: WorkflowRun): boolean {
  return (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status);
}

export function createWorkflowRunEntity(opts: CreateWorkflowRunEntityOptions): RunEntity {
  const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_MS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (entity: SynthesizedEntity, _ctx): Promise<RunEntityOutcome> => {
    if (entity.kind !== 'workflow') {
      throw new Error(`workflow run-entity received non-workflow kind: ${entity.kind}`);
    }
    const run = await opts.engine.startRun(
      entity.workflowId,
      opts.projectId,
      entity.workflow,
      'manual',
    );

    return new Promise<RunEntityOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: RunEntityOutcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poller);
        resolve(outcome);
      };

      // Primary: event listener.
      opts.engine.dispatcher.onAny((event: { runId: string; type: string }) => {
        if (event.runId !== run.id) return;
        if (!TERMINAL_EVENT_TYPES.has(event.type)) return;
        const fresh = opts.runRepo.findById(run.id);
        finish({ exitOk: fresh?.status === 'completed' });
      });

      // Fallback: polling.
      const poller = setInterval(() => {
        const fresh = opts.runRepo.findById(run.id);
        if (fresh && isTerminalRun(fresh)) {
          finish({ exitOk: fresh.status === 'completed' });
        }
      }, pollIntervalMs);

      // Hard timeout.
      const timer = setTimeout(() => finish({ exitOk: false }), timeoutMs);
    });
  };
}
