import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowStepRun,
  WorkflowStepRunStatus,
  WorkflowDefinition,
} from '@my-claudia/shared/features/workflows';
import type { WorkflowRunRepository } from '../workflow-run-repository.js';
import type { WorkflowStepRunRepository } from '../workflow-step-run-repository.js';
import { WorkflowRunAggregate } from '../run-aggregate.js';

// ── Helpers ──────────────────────────────────────────────────────────

function makeRun(overrides: Partial<WorkflowRun> = {}): WorkflowRun {
  return {
    id: 'run-1',
    workflowId: 'wf-1',
    projectId: 'proj-1',
    status: 'running' as WorkflowRunStatus,
    triggerSource: 'manual',
    startedAt: Date.now(),
    ...overrides,
  };
}

function makeStepRun(overrides: Partial<WorkflowStepRun> = {}): WorkflowStepRun {
  return {
    id: 'sr-1',
    runId: 'run-1',
    stepId: 'step-1',
    stepType: 'shell',
    status: 'pending' as WorkflowStepRunStatus,
    attempt: 1,
    ...overrides,
  };
}

function makeRunRepo(run: WorkflowRun): WorkflowRunRepository {
  let current = { ...run };
  return {
    findById: vi.fn((id: string) => (id === current.id ? { ...current } : null)),
    create: vi.fn((data: any) => {
      current = { ...current, ...data, id: current.id };
      return { ...current };
    }),
    update: vi.fn((id: string, data: any) => {
      if (id === current.id) {
        current = { ...current, ...data };
      }
      return { ...current };
    }),
    findByWorkflow: vi.fn(() => []),
    findActiveByWorkflow: vi.fn(() => null),
    findByProject: vi.fn(() => []),
    mapRow: vi.fn(),
    createQuery: vi.fn(),
    updateQuery: vi.fn(),
    delete: vi.fn(),
  } as unknown as WorkflowRunRepository;
}

function makeStepRunRepo(stepRuns: WorkflowStepRun[]): WorkflowStepRunRepository {
  const map = new Map(stepRuns.map(sr => [`${sr.runId}:${sr.stepId}`, { ...sr }]));

  return {
    findByRunAndStep: vi.fn((runId: string, stepId: string) => {
      const sr = map.get(`${runId}:${stepId}`);
      return sr ? { ...sr } : null;
    }),
    findByRun: vi.fn((runId: string) => {
      return stepRuns.filter(sr => sr.runId === runId).map(sr => ({ ...sr }));
    }),
    create: vi.fn((data: any) => {
      const sr = { ...data, id: `sr-${data.stepId}` };
      map.set(`${data.runId}:${data.stepId}`, sr);
      return sr;
    }),
    update: vi.fn((id: string, data: any) => {
      for (const [key, sr] of map) {
        if (sr.id === id) {
          const updated = { ...sr, ...data };
          map.set(key, updated);
          return updated;
        }
      }
    }),
    mapRow: vi.fn(),
    createQuery: vi.fn(),
    updateQuery: vi.fn(),
    delete: vi.fn(),
  } as unknown as WorkflowStepRunRepository;
}

function makeDefinition(): WorkflowDefinition {
  return {
    nodes: [
      { id: 'step-1', name: 'Step 1', type: 'shell', config: {}, position: { x: 0, y: 0 } },
      { id: 'step-2', name: 'Step 2', type: 'shell', config: {}, position: { x: 0, y: 150 } },
    ],
    edges: [{ id: 'e1', source: 'step-1', target: 'step-2', type: 'success' }],
    entryNodeId: 'step-1',
    triggers: [{ type: 'manual' }],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('WorkflowRunAggregate', () => {
  let run: WorkflowRun;
  let runRepo: WorkflowRunRepository;
  let stepRuns: WorkflowStepRun[];
  let stepRunRepo: WorkflowStepRunRepository;

  beforeEach(() => {
    run = makeRun();
    stepRuns = [
      makeStepRun({ id: 'sr-1', stepId: 'step-1', status: 'pending' }),
      makeStepRun({ id: 'sr-2', stepId: 'step-2', status: 'pending' }),
    ];
    runRepo = makeRunRepo(run);
    stepRunRepo = makeStepRunRepo(stepRuns);
  });

  // ── Static factory ───────────────────────────────────────────────

  describe('start()', () => {
    it('creates a run and step runs, emits run_started', () => {
      const def = makeDefinition();
      const agg = WorkflowRunAggregate.start(
        def, 'wf-1', 'proj-1', 'manual',
        runRepo, stepRunRepo,
      );

      expect(runRepo.create).toHaveBeenCalledOnce();
      expect(stepRunRepo.create).toHaveBeenCalledTimes(2);

      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('run_started');
      expect(events[0].runId).toBe(agg.id);
    });
  });

  // ── completeRun ──────────────────────────────────────────────────

  describe('completeRun()', () => {
    it('transitions running -> completed and emits run_completed', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.completeRun();

      expect(runRepo.update).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'completed',
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('run_completed');
    });

    it('throws from failed status', () => {
      const agg = new WorkflowRunAggregate(makeRun({ status: 'failed' }), runRepo, stepRunRepo);
      expect(() => agg.completeRun()).toThrow(/Invalid run transition/);
      expect(agg.releaseEvents()).toHaveLength(0);
    });

    it('throws from pending status', () => {
      const agg = new WorkflowRunAggregate(makeRun({ status: 'pending' }), runRepo, stepRunRepo);
      expect(() => agg.completeRun()).toThrow(/Invalid run transition/);
    });
  });

  // ── failRun ──────────────────────────────────────────────────────

  describe('failRun()', () => {
    it('transitions running -> failed and emits run_failed', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.failRun('Something broke');

      expect(runRepo.update).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'failed',
        error: 'Something broke',
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('run_failed');
      expect((events[0] as any).error).toBe('Something broke');
    });

    it('throws from completed status', () => {
      const agg = new WorkflowRunAggregate(makeRun({ status: 'completed' }), runRepo, stepRunRepo);
      expect(() => agg.failRun('err')).toThrow(/Invalid run transition/);
    });
  });

  // ── cancelRun ────────────────────────────────────────────────────

  describe('cancelRun()', () => {
    it('cancels from running and emits run_cancelled', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.cancelRun();

      expect(runRepo.update).toHaveBeenCalledWith('run-1', expect.objectContaining({
        status: 'cancelled',
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('run_cancelled');
      expect((events[0] as any).fromStatus).toBe('running');
    });

    it('cancels from pending', () => {
      const agg = new WorkflowRunAggregate(makeRun({ status: 'pending' }), runRepo, stepRunRepo);
      agg.cancelRun();
      expect(agg.releaseEvents()[0].type).toBe('run_cancelled');
    });

    it('throws from completed status', () => {
      const agg = new WorkflowRunAggregate(makeRun({ status: 'completed' }), runRepo, stepRunRepo);
      expect(() => agg.cancelRun()).toThrow(/Invalid run transition/);
    });
  });

  // ── startStep ────────────────────────────────────────────────────

  describe('startStep()', () => {
    it('transitions pending -> running and emits step_started', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.startStep('step-1', 1);

      expect(stepRunRepo.update).toHaveBeenCalledWith('sr-1', expect.objectContaining({
        status: 'running',
        attempt: 1,
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('step_started');
      expect((events[0] as any).stepId).toBe('step-1');
    });

    it('throws if step not found', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);
      expect(() => agg.startStep('nonexistent')).toThrow(/Step run not found/);
    });

    it('throws for invalid transition (completed -> running)', () => {
      stepRuns[0].status = 'completed';
      stepRunRepo = makeStepRunRepo(stepRuns);
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);
      expect(() => agg.startStep('step-1')).toThrow(/Invalid step transition/);
    });
  });

  // ── completeStep ─────────────────────────────────────────────────

  describe('completeStep()', () => {
    it('transitions running -> completed and emits step_completed', () => {
      stepRuns[0].status = 'running';
      stepRunRepo = makeStepRunRepo(stepRuns);
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.completeStep('step-1', { result: 'ok' });

      expect(stepRunRepo.update).toHaveBeenCalledWith('sr-1', expect.objectContaining({
        status: 'completed',
        output: { result: 'ok' },
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('step_completed');
    });

    it('throws from pending status', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);
      expect(() => agg.completeStep('step-1')).toThrow(/Invalid step transition/);
    });
  });

  // ── failStep ─────────────────────────────────────────────────────

  describe('failStep()', () => {
    it('transitions running -> failed and emits step_failed', () => {
      stepRuns[0].status = 'running';
      stepRunRepo = makeStepRunRepo(stepRuns);
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.failStep('step-1', 'timeout');

      expect(stepRunRepo.update).toHaveBeenCalledWith('sr-1', expect.objectContaining({
        status: 'failed',
        error: 'timeout',
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('step_failed');
      expect((events[0] as any).error).toBe('timeout');
    });

    it('throws from pending status', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);
      expect(() => agg.failStep('step-1', 'err')).toThrow(/Invalid step transition/);
    });
  });

  // ── skipStep ─────────────────────────────────────────────────────

  describe('skipStep()', () => {
    it('skips from pending and emits step_skipped', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.skipStep('step-1');

      expect(stepRunRepo.update).toHaveBeenCalledWith('sr-1', expect.objectContaining({
        status: 'skipped',
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('step_skipped');
      expect((events[0] as any).fromStatus).toBe('pending');
    });

    it('skips from running', () => {
      stepRuns[0].status = 'running';
      stepRunRepo = makeStepRunRepo(stepRuns);
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.skipStep('step-1');
      expect(agg.releaseEvents()[0].type).toBe('step_skipped');
    });

    it('throws from completed status', () => {
      stepRuns[0].status = 'completed';
      stepRunRepo = makeStepRunRepo(stepRuns);
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);
      expect(() => agg.skipStep('step-1')).toThrow(/Invalid step transition/);
    });
  });

  // ── markStepWaiting ──────────────────────────────────────────────

  describe('markStepWaiting()', () => {
    it('transitions pending -> waiting and emits step_waiting_for_approval', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.markStepWaiting('step-1');

      expect(stepRunRepo.update).toHaveBeenCalledWith('sr-1', expect.objectContaining({
        status: 'waiting',
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('step_waiting_for_approval');
    });

    it('throws from running status', () => {
      stepRuns[0].status = 'running';
      stepRunRepo = makeStepRunRepo(stepRuns);
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);
      expect(() => agg.markStepWaiting('step-1')).toThrow(/Invalid step transition/);
    });
  });

  // ── markStepResumed ──────────────────────────────────────────────

  describe('markStepResumed()', () => {
    it('transitions waiting -> running and emits step_approved', () => {
      stepRuns[0].status = 'waiting';
      stepRunRepo = makeStepRunRepo(stepRuns);
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.markStepResumed('step-1');

      expect(stepRunRepo.update).toHaveBeenCalledWith('sr-1', expect.objectContaining({
        status: 'running',
      }));
      const events = agg.releaseEvents();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('step_approved');
    });

    it('throws from completed status', () => {
      stepRuns[0].status = 'completed';
      stepRunRepo = makeStepRunRepo(stepRuns);
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);
      expect(() => agg.markStepResumed('step-1')).toThrow(/Invalid step transition/);
    });
  });

  // ── releaseEvents drains ─────────────────────────────────────────

  describe('releaseEvents()', () => {
    it('drains events on each call', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.completeRun();
      expect(agg.releaseEvents()).toHaveLength(1);
      expect(agg.releaseEvents()).toHaveLength(0);
    });
  });

  // ── snapshot reflects latest state ───────────────────────────────

  describe('snapshot', () => {
    it('reflects updated state after command', () => {
      const agg = new WorkflowRunAggregate(run, runRepo, stepRunRepo);

      agg.completeRun();
      expect(agg.snapshot.status).toBe('completed');
    });
  });
});
