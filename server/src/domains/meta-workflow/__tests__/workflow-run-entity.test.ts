// server/src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createWorkflowRunEntity } from '../run-entities/workflow-run-entity.js';
import type { WorkflowRun } from '@my-claudia/shared/features/workflows';

function makeFakeDispatcher() {
  type Handler = (e: { runId: string; type: string }) => void;
  const handlers: Handler[] = [];
  return {
    onAny: (h: Handler) => { handlers.push(h); },
    dispatch: (e: { runId: string; type: string }) => { for (const h of handlers) h(e); },
  };
}

describe('workflow run-entity adapter', () => {
  it('resolves exitOk=true when run_completed event arrives', async () => {
    const dispatcher = makeFakeDispatcher();
    const engine = {
      dispatcher,
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValue({ id: 'run-1', status: 'completed' }),
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    });

    const outcomeP = runEntity(
      { kind: 'workflow', workflow: { nodes: [], edges: [], entryNodeId: '', triggers: [] }, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    // simulate engine emitting completion event
    setTimeout(() => dispatcher.dispatch({ runId: 'run-1', type: 'run_completed' }), 0);
    const outcome = await outcomeP;
    expect(outcome.exitOk).toBe(true);
  });

  it('resolves exitOk=false when run_failed event arrives', async () => {
    const dispatcher = makeFakeDispatcher();
    const engine = {
      dispatcher,
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValue({ id: 'run-1', status: 'failed' }),
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    });

    const outcomeP = runEntity(
      { kind: 'workflow', workflow: { nodes: [], edges: [], entryNodeId: '', triggers: [] }, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    setTimeout(() => dispatcher.dispatch({ runId: 'run-1', type: 'run_failed' }), 0);
    const outcome = await outcomeP;
    expect(outcome.exitOk).toBe(false);
  });

  it('falls back to polling when no events arrive but the run already finished', async () => {
    const dispatcher = makeFakeDispatcher();
    const engine = {
      dispatcher,
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn()
        .mockReturnValueOnce({ id: 'run-1', status: 'running' })
        .mockReturnValueOnce({ id: 'run-1', status: 'completed' }),
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    });
    const outcome = await runEntity(
      { kind: 'workflow', workflow: { nodes: [], edges: [], entryNodeId: '', triggers: [] }, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    expect(outcome.exitOk).toBe(true);
  });

  it('times out and returns exitOk=false', async () => {
    const dispatcher = makeFakeDispatcher();
    const engine = {
      dispatcher,
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValue({ id: 'run-1', status: 'running' }),
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 5,
    });
    const outcome = await runEntity(
      { kind: 'workflow', workflow: { nodes: [], edges: [], entryNodeId: '', triggers: [] }, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    expect(outcome.exitOk).toBe(false);
  });

  it('rejects non-workflow kind', async () => {
    const runEntity = createWorkflowRunEntity({
      engine: { dispatcher: makeFakeDispatcher() } as never,
      runRepo: {} as never,
      projectId: 'p1',
    });
    await expect(runEntity(
      { kind: 'subagent', subagent: {} as never },
      { worktreePath: '/tmp/wt' },
    )).rejects.toThrow(/workflow/i);
  });
});
