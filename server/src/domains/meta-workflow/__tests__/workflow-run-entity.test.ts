// server/src/domains/meta-workflow/__tests__/workflow-run-entity.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createWorkflowRunEntity } from '../run-entities/workflow-run-entity.js';
import type { WorkflowRun } from '@my-claudia/shared/features/workflows';

describe('workflow run-entity adapter', () => {
  it('returns exitOk=true when engine completes successfully', async () => {
    const engine = {
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
      { kind: 'workflow', workflow: {} as never, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    expect(outcome.exitOk).toBe(true);
  });

  it('returns exitOk=false when engine run fails', async () => {
    const engine = {
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValueOnce({ id: 'run-1', status: 'failed', error: 'boom' }),
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 1000,
    });
    const outcome = await runEntity(
      { kind: 'workflow', workflow: {} as never, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    expect(outcome.exitOk).toBe(false);
  });

  it('returns exitOk=false on timeout', async () => {
    const engine = {
      startRun: vi.fn().mockResolvedValue({ id: 'run-1', status: 'running' } as WorkflowRun),
    };
    const runRepo = {
      findById: vi.fn().mockReturnValue({ id: 'run-1', status: 'running' }),  // never finishes
    };
    const runEntity = createWorkflowRunEntity({
      engine: engine as never,
      runRepo: runRepo as never,
      projectId: 'p1',
      pollIntervalMs: 1,
      timeoutMs: 5,
    });
    const outcome = await runEntity(
      { kind: 'workflow', workflow: {} as never, workflowId: 'wf-1' },
      { worktreePath: '/tmp/wt' },
    );
    expect(outcome.exitOk).toBe(false);
  });

  it('rejects non-workflow kind', async () => {
    const runEntity = createWorkflowRunEntity({
      engine: {} as never, runRepo: {} as never, projectId: 'p1',
    });
    await expect(runEntity(
      { kind: 'subagent', subagent: {} as never },
      { worktreePath: '/tmp/wt' },
    )).rejects.toThrow('workflow run-entity received non-workflow kind: subagent');
  });
});
