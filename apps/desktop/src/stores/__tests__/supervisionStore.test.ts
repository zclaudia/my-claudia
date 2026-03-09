import { describe, it, expect, beforeEach } from 'vitest';
import { useSupervisionStore } from '../supervisionStore';
import type { SupervisionTask, ProjectAgent } from '@my-claudia/shared';

// Helper to create mock task
function makeTask(overrides: Partial<SupervisionTask> = {}): SupervisionTask {
  return {
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
  };
}

// Helper to create mock agent
function makeAgent(overrides: Partial<ProjectAgent> = {}): ProjectAgent {
  return {
    projectId: 'proj-1',
    phase: 'idle',
    config: {
      maxConcurrentTasks: 2,
      trustLevel: 'medium',
      autoDiscoverTasks: false,
    },
    ...overrides,
  };
}

describe('supervisionStore', () => {
  beforeEach(() => {
    // Reset store to initial state
    useSupervisionStore.setState({
      tasks: {},
      agents: {},
      lastCheckpoint: {},
    });
  });

  describe('setTasks', () => {
    it('sets tasks for a project', () => {
      const tasks = [makeTask(), makeTask({ id: 'task-2' })];

      useSupervisionStore.getState().setTasks('proj-1', tasks);

      expect(useSupervisionStore.getState().tasks['proj-1']).toEqual(tasks);
    });

    it('replaces existing tasks for a project', () => {
      const initialTasks = [makeTask()];
      useSupervisionStore.getState().setTasks('proj-1', initialTasks);

      const newTasks = [makeTask({ id: 'task-new' })];
      useSupervisionStore.getState().setTasks('proj-1', newTasks);

      expect(useSupervisionStore.getState().tasks['proj-1']).toEqual(newTasks);
    });

    it('does not affect other projects tasks', () => {
      const proj1Tasks = [makeTask()];
      const proj2Tasks = [makeTask({ id: 'task-2', projectId: 'proj-2' })];

      useSupervisionStore.getState().setTasks('proj-1', proj1Tasks);
      useSupervisionStore.getState().setTasks('proj-2', proj2Tasks);

      expect(useSupervisionStore.getState().tasks['proj-1']).toEqual(proj1Tasks);
      expect(useSupervisionStore.getState().tasks['proj-2']).toEqual(proj2Tasks);
    });
  });

  describe('upsertTask', () => {
    it('adds new task to empty project', () => {
      const task = makeTask();

      useSupervisionStore.getState().upsertTask('proj-1', task);

      expect(useSupervisionStore.getState().tasks['proj-1']).toEqual([task]);
    });

    it('adds new task to existing list', () => {
      const task1 = makeTask();
      const task2 = makeTask({ id: 'task-2' });

      useSupervisionStore.getState().setTasks('proj-1', [task1]);
      useSupervisionStore.getState().upsertTask('proj-1', task2);

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(2);
      expect(useSupervisionStore.getState().tasks['proj-1']).toContainEqual(task2);
    });

    it('updates existing task by id', () => {
      const task = makeTask();
      useSupervisionStore.getState().setTasks('proj-1', [task]);

      const updatedTask = { ...task, title: 'Updated Title', status: 'running' as const };
      useSupervisionStore.getState().upsertTask('proj-1', updatedTask);

      const tasks = useSupervisionStore.getState().tasks['proj-1'];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].title).toBe('Updated Title');
      expect(tasks[0].status).toBe('running');
    });

    it('preserves task order when updating', () => {
      const task1 = makeTask();
      const task2 = makeTask({ id: 'task-2' });
      const task3 = makeTask({ id: 'task-3' });
      useSupervisionStore.getState().setTasks('proj-1', [task1, task2, task3]);

      const updatedTask2 = { ...task2, title: 'Updated Task 2' };
      useSupervisionStore.getState().upsertTask('proj-1', updatedTask2);

      const tasks = useSupervisionStore.getState().tasks['proj-1'];
      expect(tasks[0].id).toBe('task-1');
      expect(tasks[1].id).toBe('task-2');
      expect(tasks[1].title).toBe('Updated Task 2');
      expect(tasks[2].id).toBe('task-3');
    });
  });

  describe('removeTask', () => {
    it('removes task by id', () => {
      const task1 = makeTask();
      const task2 = makeTask({ id: 'task-2' });
      useSupervisionStore.getState().setTasks('proj-1', [task1, task2]);

      useSupervisionStore.getState().removeTask('proj-1', 'task-1');

      const tasks = useSupervisionStore.getState().tasks['proj-1'];
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task-2');
    });

    it('handles non-existent task gracefully', () => {
      const task = makeTask();
      useSupervisionStore.getState().setTasks('proj-1', [task]);

      useSupervisionStore.getState().removeTask('proj-1', 'non-existent');

      expect(useSupervisionStore.getState().tasks['proj-1']).toHaveLength(1);
    });

    it('handles empty project tasks gracefully', () => {
      useSupervisionStore.getState().removeTask('proj-1', 'task-1');

      expect(useSupervisionStore.getState().tasks['proj-1']).toEqual([]);
    });
  });

  describe('setAgent', () => {
    it('sets agent for a project', () => {
      const agent = makeAgent();

      useSupervisionStore.getState().setAgent('proj-1', agent);

      expect(useSupervisionStore.getState().agents['proj-1']).toEqual(agent);
    });

    it('replaces existing agent', () => {
      const agent1 = makeAgent();
      useSupervisionStore.getState().setAgent('proj-1', agent1);

      const agent2 = makeAgent({ phase: 'running' });
      useSupervisionStore.getState().setAgent('proj-1', agent2);

      expect(useSupervisionStore.getState().agents['proj-1'].phase).toBe('running');
    });

    it('does not affect other project agents', () => {
      const agent1 = makeAgent();
      const agent2 = makeAgent({ projectId: 'proj-2' });

      useSupervisionStore.getState().setAgent('proj-1', agent1);
      useSupervisionStore.getState().setAgent('proj-2', agent2);

      expect(useSupervisionStore.getState().agents['proj-1']).toEqual(agent1);
      expect(useSupervisionStore.getState().agents['proj-2']).toEqual(agent2);
    });
  });

  describe('removeAgent', () => {
    it('removes agent by projectId', () => {
      const agent = makeAgent();
      useSupervisionStore.getState().setAgent('proj-1', agent);

      useSupervisionStore.getState().removeAgent('proj-1');

      expect(useSupervisionStore.getState().agents['proj-1']).toBeUndefined();
    });

    it('does not affect other agents', () => {
      const agent1 = makeAgent();
      const agent2 = makeAgent({ projectId: 'proj-2' });
      useSupervisionStore.getState().setAgent('proj-1', agent1);
      useSupervisionStore.getState().setAgent('proj-2', agent2);

      useSupervisionStore.getState().removeAgent('proj-1');

      expect(useSupervisionStore.getState().agents['proj-1']).toBeUndefined();
      expect(useSupervisionStore.getState().agents['proj-2']).toEqual(agent2);
    });

    it('handles non-existent agent gracefully', () => {
      useSupervisionStore.getState().removeAgent('non-existent');

      expect(Object.keys(useSupervisionStore.getState().agents)).toHaveLength(0);
    });
  });

  describe('setCheckpointSummary', () => {
    it('sets checkpoint for a project', () => {
      useSupervisionStore.getState().setCheckpointSummary('proj-1', 'Test checkpoint');

      expect(useSupervisionStore.getState().lastCheckpoint['proj-1']).toBe('Test checkpoint');
    });

    it('replaces existing checkpoint', () => {
      useSupervisionStore.getState().setCheckpointSummary('proj-1', 'First checkpoint');
      useSupervisionStore.getState().setCheckpointSummary('proj-1', 'Second checkpoint');

      expect(useSupervisionStore.getState().lastCheckpoint['proj-1']).toBe('Second checkpoint');
    });

    it('does not affect other project checkpoints', () => {
      useSupervisionStore.getState().setCheckpointSummary('proj-1', 'Checkpoint 1');
      useSupervisionStore.getState().setCheckpointSummary('proj-2', 'Checkpoint 2');

      expect(useSupervisionStore.getState().lastCheckpoint['proj-1']).toBe('Checkpoint 1');
      expect(useSupervisionStore.getState().lastCheckpoint['proj-2']).toBe('Checkpoint 2');
    });
  });
});
