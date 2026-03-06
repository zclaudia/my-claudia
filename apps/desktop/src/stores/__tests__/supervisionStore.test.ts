import { describe, it, expect, beforeEach } from 'vitest';
import { useSupervisionStore } from '../supervisionStore';
import type { Supervision, SupervisionTask, ProjectAgent } from '@my-claudia/shared';

describe('supervisionStore', () => {
  beforeEach(() => {
    useSupervisionStore.setState({ supervisions: {} });
  });

  const createSupervision = (overrides: Partial<Supervision> = {}): Supervision => ({
    id: 'sup-1',
    sessionId: 'session-1',
    goal: 'Test goal',
    status: 'active',
    maxIterations: 10,
    currentIteration: 0,
    cooldownSeconds: 30,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  describe('setSupervision', () => {
    it('sets a supervision for a session', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);

      expect(useSupervisionStore.getState().supervisions['session-1']).toEqual(supervision);
    });

    it('replaces existing supervision for same session', () => {
      const old = createSupervision({ goal: 'Old goal' });
      const updated = createSupervision({ goal: 'New goal' });

      useSupervisionStore.getState().setSupervision('session-1', old);
      useSupervisionStore.getState().setSupervision('session-1', updated);

      expect(useSupervisionStore.getState().supervisions['session-1'].goal).toBe('New goal');
    });

    it('removes supervision when called with null', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);
      useSupervisionStore.getState().setSupervision('session-1', null);

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
    });

    it('does not affect other sessions', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);

      expect(useSupervisionStore.getState().supervisions['session-1']).toEqual(sup1);
      expect(useSupervisionStore.getState().supervisions['session-2']).toEqual(sup2);
    });

    it('removing one session does not affect others', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);
      useSupervisionStore.getState().setSupervision('session-1', null);

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
      expect(useSupervisionStore.getState().supervisions['session-2']).toEqual(sup2);
    });
  });

  describe('updateSupervision', () => {
    it('updates an existing supervision', () => {
      const supervision = createSupervision({ currentIteration: 0 });
      useSupervisionStore.getState().setSupervision('session-1', supervision);

      const updated = { ...supervision, currentIteration: 5 };
      useSupervisionStore.getState().updateSupervision(updated);

      expect(useSupervisionStore.getState().supervisions['session-1'].currentIteration).toBe(5);
    });

    it('adds supervision for non-existent session (upsert behavior)', () => {
      const supervision = createSupervision({ sessionId: 'session-new' });
      useSupervisionStore.getState().updateSupervision(supervision);

      expect(useSupervisionStore.getState().supervisions['session-new']).toEqual(supervision);
    });

    it('does not affect other sessions when updating', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1', goal: 'Goal A' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2', goal: 'Goal B' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);

      const updated = { ...sup1, goal: 'Updated Goal A' };
      useSupervisionStore.getState().updateSupervision(updated);

      expect(useSupervisionStore.getState().supervisions['session-1'].goal).toBe('Updated Goal A');
      expect(useSupervisionStore.getState().supervisions['session-2'].goal).toBe('Goal B');
    });
  });

  describe('removeSupervision', () => {
    it('removes a supervision by sessionId', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);
      useSupervisionStore.getState().removeSupervision('session-1');

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
    });

    it('does nothing when removing non-existent session', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);
      useSupervisionStore.getState().removeSupervision('session-nonexistent');

      expect(useSupervisionStore.getState().supervisions['session-1']).toEqual(supervision);
    });

    it('does not affect other sessions', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);
      useSupervisionStore.getState().removeSupervision('session-1');

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
      expect(useSupervisionStore.getState().supervisions['session-2']).toEqual(sup2);
    });
  });

  describe('pendingPlanningHints', () => {
    beforeEach(() => {
      useSupervisionStore.setState({ pendingPlanningHints: {} });
    });

    it('sets a pending hint for a session', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Build auth');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('Build auth');
    });

    it('overwrites existing hint for same session', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Old hint');
      useSupervisionStore.getState().setPendingHint('session-1', 'New hint');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('New hint');
    });

    it('does not affect hints for other sessions', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Hint A');
      useSupervisionStore.getState().setPendingHint('session-2', 'Hint B');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('Hint A');
      expect(useSupervisionStore.getState().pendingPlanningHints['session-2']).toBe('Hint B');
    });

    it('clears a pending hint for a session', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'To be cleared');
      useSupervisionStore.getState().clearPendingHint('session-1');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBeUndefined();
    });

    it('clearing one session does not affect others', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Hint A');
      useSupervisionStore.getState().setPendingHint('session-2', 'Hint B');
      useSupervisionStore.getState().clearPendingHint('session-1');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBeUndefined();
      expect(useSupervisionStore.getState().pendingPlanningHints['session-2']).toBe('Hint B');
    });

    it('clearing non-existent session is a no-op', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Keep me');
      useSupervisionStore.getState().clearPendingHint('session-nonexistent');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('Keep me');
    });

    it('does not affect supervisions state', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);
      useSupervisionStore.getState().setPendingHint('session-1', 'Some hint');

      expect(useSupervisionStore.getState().supervisions['session-1']).toEqual(supervision);
      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('Some hint');
    });
  });

  describe('multi-session scenarios', () => {
    it('handles multiple sessions simultaneously', () => {
      const sessions = Array.from({ length: 5 }, (_, i) =>
        createSupervision({ id: `sup-${i}`, sessionId: `session-${i}`, goal: `Goal ${i}` })
      );

      sessions.forEach((sup) => {
        useSupervisionStore.getState().setSupervision(sup.sessionId, sup);
      });

      expect(Object.keys(useSupervisionStore.getState().supervisions)).toHaveLength(5);

      sessions.forEach((sup) => {
        expect(useSupervisionStore.getState().supervisions[sup.sessionId]).toEqual(sup);
      });
    });

    it('handles interleaved set and remove operations', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2' });
      const sup3 = createSupervision({ id: 'sup-3', sessionId: 'session-3' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);
      useSupervisionStore.getState().removeSupervision('session-1');
      useSupervisionStore.getState().setSupervision('session-3', sup3);

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
      expect(useSupervisionStore.getState().supervisions['session-2']).toEqual(sup2);
      expect(useSupervisionStore.getState().supervisions['session-3']).toEqual(sup3);
    });

    it('update on non-existent then remove behaves correctly', () => {
      const supervision = createSupervision({ sessionId: 'session-new' });

      useSupervisionStore.getState().updateSupervision(supervision);
      expect(useSupervisionStore.getState().supervisions['session-new']).toEqual(supervision);

      useSupervisionStore.getState().removeSupervision('session-new');
      expect(useSupervisionStore.getState().supervisions['session-new']).toBeUndefined();
    });
  });
});

// ====== V2 Store Actions ======

describe('supervisionStore V2', () => {
  const createAgent = (overrides: Partial<ProjectAgent> = {}): ProjectAgent => ({
    type: 'supervisor',
    phase: 'active',
    config: {
      maxConcurrentTasks: 2,
      trustLevel: 'medium',
      autoDiscoverTasks: false,
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  const createTask = (overrides: Partial<SupervisionTask> = {}): SupervisionTask => ({
    id: 'task-1',
    projectId: 'proj-1',
    title: 'Test Task',
    description: 'A test task',
    source: 'user',
    status: 'pending',
    priority: 0,
    dependencies: [],
    dependencyMode: 'all',
    acceptanceCriteria: [],
    maxRetries: 2,
    attempt: 1,
    createdAt: Date.now(),
    ...overrides,
  });

  beforeEach(() => {
    useSupervisionStore.setState({
      tasks: {},
      agents: {},
      lastCheckpoint: {},
    });
  });

  describe('setTasks', () => {
    it('sets tasks for a project', () => {
      const tasks = [createTask({ id: 't1' }), createTask({ id: 't2' })];
      useSupervisionStore.getState().setTasks('proj-1', tasks);

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(2);
      expect(useSupervisionStore.getState().tasks['proj-1'][0].id).toBe('t1');
    });

    it('replaces existing tasks for the same project', () => {
      useSupervisionStore.getState().setTasks('proj-1', [createTask({ id: 'old' })]);
      useSupervisionStore.getState().setTasks('proj-1', [createTask({ id: 'new' })]);

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(1);
      expect(useSupervisionStore.getState().tasks['proj-1'][0].id).toBe('new');
    });

    it('does not affect other projects', () => {
      const tasks1 = [createTask({ id: 't1', projectId: 'proj-1' })];
      const tasks2 = [createTask({ id: 't2', projectId: 'proj-2' })];
      useSupervisionStore.getState().setTasks('proj-1', tasks1);
      useSupervisionStore.getState().setTasks('proj-2', tasks2);

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(1);
      expect(useSupervisionStore.getState().tasks['proj-2']).toHaveLength(1);
    });

    it('sets empty array', () => {
      useSupervisionStore.getState().setTasks('proj-1', []);
      expect(useSupervisionStore.getState().tasks['proj-1']).toEqual([]);
    });
  });

  describe('upsertTask', () => {
    it('inserts a new task when none exist', () => {
      const task = createTask({ id: 't1' });
      useSupervisionStore.getState().upsertTask('proj-1', task);

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(1);
      expect(useSupervisionStore.getState().tasks['proj-1'][0].id).toBe('t1');
    });

    it('appends a new task to existing list', () => {
      useSupervisionStore.getState().setTasks('proj-1', [createTask({ id: 't1' })]);
      useSupervisionStore.getState().upsertTask('proj-1', createTask({ id: 't2' }));

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(2);
    });

    it('updates an existing task by id', () => {
      useSupervisionStore.getState().setTasks('proj-1', [
        createTask({ id: 't1', title: 'Old Title' }),
      ]);
      useSupervisionStore.getState().upsertTask('proj-1', createTask({ id: 't1', title: 'New Title' }));

      const tasks = useSupervisionStore.getState().tasks['proj-1'];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('New Title');
    });

    it('does not affect other projects', () => {
      useSupervisionStore.getState().setTasks('proj-1', [createTask({ id: 't1' })]);
      useSupervisionStore.getState().upsertTask('proj-2', createTask({ id: 't2' }));

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(1);
      expect(useSupervisionStore.getState().tasks['proj-2']).toHaveLength(1);
    });
  });

  describe('removeTask', () => {
    it('removes a task by id', () => {
      useSupervisionStore.getState().setTasks('proj-1', [
        createTask({ id: 't1' }),
        createTask({ id: 't2' }),
      ]);
      useSupervisionStore.getState().removeTask('proj-1', 't1');

      const tasks = useSupervisionStore.getState().tasks['proj-1'];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('t2');
    });

    it('is a no-op for non-existent task id', () => {
      useSupervisionStore.getState().setTasks('proj-1', [createTask({ id: 't1' })]);
      useSupervisionStore.getState().removeTask('proj-1', 'nonexistent');

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(1);
    });

    it('handles empty project task list', () => {
      useSupervisionStore.getState().removeTask('proj-1', 't1');
      expect(useSupervisionStore.getState().tasks['proj-1']).toEqual([]);
    });

    it('does not affect other projects', () => {
      useSupervisionStore.getState().setTasks('proj-1', [createTask({ id: 't1' })]);
      useSupervisionStore.getState().setTasks('proj-2', [createTask({ id: 't2' })]);
      useSupervisionStore.getState().removeTask('proj-1', 't1');

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(0);
      expect(useSupervisionStore.getState().tasks['proj-2']).toHaveLength(1);
    });
  });

  describe('setAgent', () => {
    it('sets an agent for a project', () => {
      const agent = createAgent();
      useSupervisionStore.getState().setAgent('proj-1', agent);

      expect(useSupervisionStore.getState().agents['proj-1']).toEqual(agent);
    });

    it('replaces existing agent', () => {
      useSupervisionStore.getState().setAgent('proj-1', createAgent({ phase: 'initializing' }));
      useSupervisionStore.getState().setAgent('proj-1', createAgent({ phase: 'active' }));

      expect(useSupervisionStore.getState().agents['proj-1'].phase).toBe('active');
    });

    it('does not affect other projects', () => {
      useSupervisionStore.getState().setAgent('proj-1', createAgent({ phase: 'active' }));
      useSupervisionStore.getState().setAgent('proj-2', createAgent({ phase: 'paused' }));

      expect(useSupervisionStore.getState().agents['proj-1'].phase).toBe('active');
      expect(useSupervisionStore.getState().agents['proj-2'].phase).toBe('paused');
    });
  });

  describe('removeAgent', () => {
    it('removes an agent for a project', () => {
      useSupervisionStore.getState().setAgent('proj-1', createAgent());
      useSupervisionStore.getState().removeAgent('proj-1');

      expect(useSupervisionStore.getState().agents['proj-1']).toBeUndefined();
    });

    it('is a no-op for non-existent project', () => {
      useSupervisionStore.getState().setAgent('proj-1', createAgent());
      useSupervisionStore.getState().removeAgent('proj-nonexistent');

      expect(useSupervisionStore.getState().agents['proj-1']).toBeDefined();
    });

    it('does not affect other projects', () => {
      useSupervisionStore.getState().setAgent('proj-1', createAgent());
      useSupervisionStore.getState().setAgent('proj-2', createAgent());
      useSupervisionStore.getState().removeAgent('proj-1');

      expect(useSupervisionStore.getState().agents['proj-1']).toBeUndefined();
      expect(useSupervisionStore.getState().agents['proj-2']).toBeDefined();
    });
  });

  describe('setCheckpointSummary', () => {
    it('sets a checkpoint summary for a project', () => {
      useSupervisionStore.getState().setCheckpointSummary('proj-1', 'Completed 3 tasks');

      expect(useSupervisionStore.getState().lastCheckpoint['proj-1']).toBe('Completed 3 tasks');
    });

    it('replaces existing summary', () => {
      useSupervisionStore.getState().setCheckpointSummary('proj-1', 'Old summary');
      useSupervisionStore.getState().setCheckpointSummary('proj-1', 'New summary');

      expect(useSupervisionStore.getState().lastCheckpoint['proj-1']).toBe('New summary');
    });

    it('does not affect other projects', () => {
      useSupervisionStore.getState().setCheckpointSummary('proj-1', 'Summary A');
      useSupervisionStore.getState().setCheckpointSummary('proj-2', 'Summary B');

      expect(useSupervisionStore.getState().lastCheckpoint['proj-1']).toBe('Summary A');
      expect(useSupervisionStore.getState().lastCheckpoint['proj-2']).toBe('Summary B');
    });
  });

  describe('V2 cross-action scenarios', () => {
    it('agent and tasks are independent', () => {
      const agent = createAgent();
      const tasks = [createTask({ id: 't1' })];

      useSupervisionStore.getState().setAgent('proj-1', agent);
      useSupervisionStore.getState().setTasks('proj-1', tasks);

      useSupervisionStore.getState().removeAgent('proj-1');

      expect(useSupervisionStore.getState().agents['proj-1']).toBeUndefined();
      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(1);
    });

    it('checkpoint is independent of agent and tasks', () => {
      useSupervisionStore.getState().setAgent('proj-1', createAgent());
      useSupervisionStore.getState().setTasks('proj-1', [createTask()]);
      useSupervisionStore.getState().setCheckpointSummary('proj-1', 'All good');

      useSupervisionStore.getState().removeAgent('proj-1');
      useSupervisionStore.getState().setTasks('proj-1', []);

      expect(useSupervisionStore.getState().lastCheckpoint['proj-1']).toBe('All good');
    });

    it('upsert then remove then upsert works correctly', () => {
      const task = createTask({ id: 't1', title: 'Original' });
      useSupervisionStore.getState().upsertTask('proj-1', task);
      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(1);

      useSupervisionStore.getState().removeTask('proj-1', 't1');
      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(0);

      useSupervisionStore.getState().upsertTask('proj-1', createTask({ id: 't1', title: 'Reinserted' }));
      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(1);
      expect(useSupervisionStore.getState().tasks['proj-1'][0].title).toBe('Reinserted');
    });
  });
});
