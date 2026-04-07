import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { SupervisionTask, TaskStatus } from '@my-claudia/shared/features/supervision';
import type { SupervisionTaskRepository } from '../../../infrastructure/repositories/supervision-task.js';
import { TaskAggregate } from '../task-aggregate.js';
import type { SupervisionTaskEvent } from '../task-events.js';

// ── Helpers ─────────────────────────────────────────────────────────

function makeTask(overrides: Partial<SupervisionTask> = {}): SupervisionTask {
  return {
    id: 'task-1',
    projectId: 'proj-1',
    title: 'Test task',
    description: 'Do something',
    source: 'user',
    status: 'pending' as TaskStatus,
    priority: 0,
    dependencies: [],
    dependencyMode: 'all',
    acceptanceCriteria: [],
    maxRetries: 2,
    attempt: 1,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeRepo(task: SupervisionTask): SupervisionTaskRepository {
  // Keep a mutable snapshot that updateStatus / update can modify
  let current = { ...task };

  return {
    findById: vi.fn((id: string) => (id === current.id ? { ...current } : undefined)),
    create: vi.fn((data: any) => {
      current = {
        ...current,
        ...data,
        id: current.id,
        createdAt: Date.now(),
        attempt: 1,
      };
      return { ...current };
    }),
    updateStatus: vi.fn((id: string, status: TaskStatus, extra?: any) => {
      if (id === current.id) {
        current = { ...current, status, ...extra };
      }
    }),
    update: vi.fn((id: string, data: any) => {
      if (id === current.id) {
        current = { ...current, ...data };
      }
      return { ...current };
    }),
    findByProjectId: vi.fn(() => []),
    findByStatus: vi.fn(() => []),
    countByProject: vi.fn(() => 0),
    delete: vi.fn(),
    mapRow: vi.fn(),
  } as unknown as SupervisionTaskRepository;
}

// ── Tests ───────────────────────────────────────────────────────────

describe('TaskAggregate', () => {
  let task: SupervisionTask;
  let repo: SupervisionTaskRepository;

  beforeEach(() => {
    task = makeTask();
    repo = makeRepo(task);
  });

  // ── Static factory ──────────────────────────────────────────────

  describe('create()', () => {
    it('creates a task via repo and emits task_created', () => {
      const agg = TaskAggregate.create(
        {
          projectId: 'proj-1',
          title: 'New task',
          description: 'Details',
          source: 'user',
        },
        'medium',
        repo,
      );

      expect(repo.create).toHaveBeenCalledOnce();
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_created');
      expect((events[0] as any).source).toBe('user');
    });

    it('resolves status to proposed for low-trust agent_discovered', () => {
      const agg = TaskAggregate.create(
        {
          projectId: 'proj-1',
          title: 'Discovered',
          description: 'Discovered by agent',
          source: 'agent_discovered',
        },
        'low',
        repo,
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'proposed' }),
      );
      const events = agg.releaseEvents();
      expect(events[0].type).toBe('task_created');
    });

    it('resolves status to pending for user source', () => {
      TaskAggregate.create(
        {
          projectId: 'proj-1',
          title: 'User task',
          description: 'Manual',
        },
        'low',
        repo,
      );

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'pending' }),
      );
    });
  });

  // ── approve ─────────────────────────────────────────────────────

  describe('approve()', () => {
    it('transitions proposed -> pending and emits task_approved', () => {
      task = makeTask({ status: 'proposed' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.approve();

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'pending');
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_approved');
      expect((events[0] as any).fromStatus).toBe('proposed');
    });

    it('throws if status is not proposed', () => {
      const agg = new TaskAggregate(makeTask({ status: 'running' }), repo);
      expect(() => agg.approve()).toThrow(/Cannot approve/);
      expect(agg.releaseEvents()).toHaveLength(0);
    });
  });

  // ── reject ──────────────────────────────────────────────────────

  describe('reject()', () => {
    it('transitions proposed -> cancelled and emits task_rejected', () => {
      task = makeTask({ status: 'proposed' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.reject();

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'cancelled');
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_rejected');
    });

    it('throws if status is not proposed', () => {
      const agg = new TaskAggregate(makeTask({ status: 'pending' }), repo);
      expect(() => agg.reject()).toThrow(/Cannot reject/);
    });
  });

  // ── openSession ─────────────────────────────────────────────────

  describe('openSession()', () => {
    it('transitions to planning and emits task_session_opened', () => {
      task = makeTask({ status: 'pending' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.openSession('sess-1');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'planning', { sessionId: 'sess-1' });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_session_opened');
      expect((events[0] as any).sessionId).toBe('sess-1');
    });

    it('throws for invalid transition', () => {
      const agg = new TaskAggregate(makeTask({ status: 'running' }), repo);
      expect(() => agg.openSession('sess-1')).toThrow(/Invalid task transition/);
    });
  });

  // ── update ──────────────────────────────────────────────────────

  describe('update()', () => {
    it('updates fields and emits task_updated with field names', () => {
      const agg = new TaskAggregate(task, repo);

      agg.update({ title: 'New title', priority: 5 });

      expect(repo.update).toHaveBeenCalledWith('task-1', { title: 'New title', priority: 5 });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_updated');
      expect((events[0] as any).fields).toEqual(expect.arrayContaining(['title', 'priority']));
    });

    it('does not emit if no fields provided', () => {
      const agg = new TaskAggregate(task, repo);
      agg.update({});
      expect(agg.releaseEvents()).toHaveLength(0);
    });
  });

  // ── submitPlan ──────────────────────────────────────────────────

  describe('submitPlan()', () => {
    it('transitions planning -> queued and emits task_plan_submitted', () => {
      task = makeTask({ status: 'planning', sessionId: 'sess-1' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.submitPlan('sess-1', '/path/to/plan');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'queued');
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_plan_submitted');
      expect((events[0] as any).planPath).toBe('/path/to/plan');
    });

    it('throws if not in planning status', () => {
      const agg = new TaskAggregate(makeTask({ status: 'queued' }), repo);
      expect(() => agg.submitPlan('sess-1')).toThrow(/Cannot submit plan for/);
    });
  });

  // ── retry ───────────────────────────────────────────────────────

  describe('retry()', () => {
    it('transitions failed -> pending and emits task_retried', () => {
      task = makeTask({ status: 'failed' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.retry();

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'pending', { attempt: 1 });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_retried');
      expect((events[0] as any).fromStatus).toBe('failed');
    });

    it('works from cancelled status', () => {
      task = makeTask({ status: 'cancelled' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.retry();
      expect(agg.releaseEvents()[0].type).toBe('task_retried');
    });

    it('throws if status is running', () => {
      const agg = new TaskAggregate(makeTask({ status: 'running' }), repo);
      expect(() => agg.retry()).toThrow(/Cannot retry/);
    });
  });

  // ── runNow ──────────────────────────────────────────────────────

  describe('runNow()', () => {
    it('transitions completed -> pending and emits task_run_now', () => {
      task = makeTask({ status: 'completed' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.runNow();

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'pending', { attempt: 1 });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_run_now');
      expect((events[0] as any).fromStatus).toBe('completed');
    });

    it('throws if status is running', () => {
      const agg = new TaskAggregate(makeTask({ status: 'running' }), repo);
      expect(() => agg.runNow()).toThrow(/Cannot run-now/);
    });
  });

  // ── cancel ──────────────────────────────────────────────────────

  describe('cancel()', () => {
    it('cancels from queued and emits task_cancelled', () => {
      task = makeTask({ status: 'queued' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.cancel();

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'cancelled');
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_cancelled');
      expect((events[0] as any).fromStatus).toBe('queued');
    });

    it('throws from integrated status', () => {
      const agg = new TaskAggregate(makeTask({ status: 'integrated' }), repo);
      expect(() => agg.cancel()).toThrow(/Invalid task transition/);
    });
  });

  // ── markStarted ─────────────────────────────────────────────────

  describe('markStarted()', () => {
    it('transitions queued -> running and emits task_started', () => {
      task = makeTask({ status: 'queued' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markStarted('sess-1', '/worktree/path', 'abc123');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'running', {
        sessionId: 'sess-1',
        baseCommit: 'abc123',
      });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      const ev = events[0] as any;
      expect(ev.type).toBe('task_started');
      expect(ev.sessionId).toBe('sess-1');
      expect(ev.workingDirectory).toBe('/worktree/path');
      expect(ev.baseCommit).toBe('abc123');
      expect(ev.fromStatus).toBe('queued');
    });

    it('throws from proposed status', () => {
      const agg = new TaskAggregate(makeTask({ status: 'proposed' }), repo);
      expect(() => agg.markStarted('s', '/w')).toThrow(/Invalid task transition/);
    });
  });

  // ── markLiteStarted ─────────────────────────────────────────────

  describe('markLiteStarted()', () => {
    it('transitions queued -> running and emits lite_task_started', () => {
      task = makeTask({ status: 'queued' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markLiteStarted('sess-lite');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'running', { sessionId: 'sess-lite' });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('lite_task_started');
      expect((events[0] as any).sessionId).toBe('sess-lite');
    });
  });

  // ── markStartFailed ─────────────────────────────────────────────

  describe('markStartFailed()', () => {
    it('transitions queued -> failed and emits task_start_failed', () => {
      task = makeTask({ status: 'queued' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markStartFailed('No rootPath');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'failed', {
        result: { summary: 'Task failed to start: No rootPath', filesChanged: [] },
      });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_start_failed');
      expect((events[0] as any).error).toBe('No rootPath');
    });
  });

  // ── transitionToReviewing ───────────────────────────────────────

  describe('transitionToReviewing()', () => {
    it('transitions running -> reviewing and emits task_run_completed', () => {
      task = makeTask({ status: 'running' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.transitionToReviewing();

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'reviewing');
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_run_completed');
    });

    it('throws from pending status', () => {
      const agg = new TaskAggregate(makeTask({ status: 'pending' }), repo);
      expect(() => agg.transitionToReviewing()).toThrow(/Invalid task transition/);
    });
  });

  // ── markRunFailed ───────────────────────────────────────────────

  describe('markRunFailed()', () => {
    it('transitions running -> failed and emits task_run_failed', () => {
      task = makeTask({ status: 'running' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markRunFailed('Connection timeout');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'failed', {
        result: { summary: 'Run failed: Connection timeout', filesChanged: [] },
      });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_run_failed');
      expect((events[0] as any).error).toBe('Connection timeout');
    });
  });

  // ── markLiteCompleted ───────────────────────────────────────────

  describe('markLiteCompleted()', () => {
    it('transitions running -> completed and emits lite_task_completed', () => {
      task = makeTask({ status: 'running' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markLiteCompleted();

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'completed', {
        result: { summary: 'Task completed', filesChanged: [] },
      });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('lite_task_completed');
    });
  });

  // ── markLiteFailed ──────────────────────────────────────────────

  describe('markLiteFailed()', () => {
    it('retries when under max retries', () => {
      task = makeTask({ status: 'running', attempt: 1, maxRetries: 2 });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markLiteFailed('Oops');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'pending', { attempt: 2 });
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      const ev = events[0] as any;
      expect(ev.type).toBe('lite_task_failed');
      expect(ev.nextStatus).toBe('pending');
      expect(ev.nextAttempt).toBe(2);
    });

    it('fails permanently when max retries exceeded', () => {
      task = makeTask({ status: 'running', attempt: 3, maxRetries: 2 });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markLiteFailed('Final failure');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'failed', expect.objectContaining({
        attempt: 4,
      }));
      const events = agg.releaseEvents();
      expect((events[0] as any).nextStatus).toBe('failed');
    });
  });

  // ── markIntegrated ──────────────────────────────────────────────

  describe('markIntegrated()', () => {
    it('transitions reviewing -> integrated and emits task_result_approved', () => {
      task = makeTask({ status: 'reviewing' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markIntegrated();

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'integrated');
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_result_approved');
    });
  });

  // ── markMergeConflict ───────────────────────────────────────────

  describe('markMergeConflict()', () => {
    it('transitions reviewing -> merge_conflict and emits task_merge_conflict', () => {
      task = makeTask({ status: 'reviewing' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markMergeConflict(['file-a.ts', 'file-b.ts']);

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'merge_conflict', expect.objectContaining({
        result: expect.objectContaining({
          reviewNotes: 'Merge conflicts: file-a.ts, file-b.ts',
        }),
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('task_merge_conflict');
      expect((events[0] as any).conflicts).toEqual(['file-a.ts', 'file-b.ts']);
    });
  });

  // ── rejectResult ────────────────────────────────────────────────

  describe('rejectResult()', () => {
    it('requeues when retries available', () => {
      task = makeTask({ status: 'reviewing', attempt: 1, maxRetries: 2 });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.rejectResult('Needs improvement');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'queued', expect.objectContaining({
        attempt: 2,
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      const ev = events[0] as any;
      expect(ev.type).toBe('task_result_rejected');
      expect(ev.nextStatus).toBe('queued');
      expect(ev.reviewNotes).toBe('Needs improvement');
    });

    it('fails when max retries exceeded', () => {
      task = makeTask({ status: 'reviewing', attempt: 3, maxRetries: 2 });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.rejectResult('Still wrong');

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'failed', expect.objectContaining({
        attempt: 4,
      }));
      const events = agg.releaseEvents();
      expect((events[0] as any).nextStatus).toBe('failed');
    });

    it('throws if not in reviewing status', () => {
      const agg = new TaskAggregate(makeTask({ status: 'running' }), repo);
      expect(() => agg.rejectResult('No')).toThrow(/Cannot reject result for/);
    });
  });

  // ── markConflictResolved ────────────────────────────────────────

  describe('markConflictResolved()', () => {
    it('transitions merge_conflict -> integrated and emits conflict_resolved', () => {
      task = makeTask({ status: 'merge_conflict' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.markConflictResolved();

      expect(repo.updateStatus).toHaveBeenCalledWith('task-1', 'integrated');
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('conflict_resolved');
    });

    it('throws if not in merge_conflict status', () => {
      const agg = new TaskAggregate(makeTask({ status: 'reviewing' }), repo);
      expect(() => agg.markConflictResolved()).toThrow(/Cannot resolve conflict for/);
    });
  });

  // ── releaseEvents drains ────────────────────────────────────────

  describe('releaseEvents()', () => {
    it('drains events on each call', () => {
      task = makeTask({ status: 'proposed' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.approve();
      expect(agg.releaseEvents()).toHaveLength(1);
      expect(agg.releaseEvents()).toHaveLength(0);
    });
  });

  // ── snapshot reflects latest state ──────────────────────────────

  describe('snapshot', () => {
    it('reflects updated state after command', () => {
      task = makeTask({ status: 'proposed' });
      repo = makeRepo(task);
      const agg = new TaskAggregate(task, repo);

      agg.approve();
      expect(agg.snapshot.status).toBe('pending');
    });
  });
});
