import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getProcessInfo } from '../../services/api';
import { useBackgroundTaskStore, type BackgroundTask } from '../backgroundTaskStore';

vi.mock('../../services/api', () => ({
  getProcessInfo: vi.fn(),
}));

const makeTask = (id: string, sessionId = 'sess-1', status: BackgroundTask['status'] = 'started'): BackgroundTask => ({
  id,
  sessionId,
  description: `Task ${id}`,
  status,
  startedAt: Date.now(),
});

describe('backgroundTaskStore', () => {
  const mockGetProcessInfo = vi.mocked(getProcessInfo);

  beforeEach(() => {
    vi.useFakeTimers();
    useBackgroundTaskStore.setState({ tasks: {} });
    mockGetProcessInfo.mockReset();
  });

  afterEach(() => {
    useBackgroundTaskStore.getState().clearTasks();
    useBackgroundTaskStore.getState().stopPidMonitor();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('addTask adds a task', () => {
    const task = makeTask('t1');
    useBackgroundTaskStore.getState().addTask(task);
    expect(useBackgroundTaskStore.getState().tasks['t1']).toEqual(task);
  });

  it('updateTask updates task fields', () => {
    useBackgroundTaskStore.setState({ tasks: { t1: makeTask('t1') } });
    useBackgroundTaskStore.getState().updateTask('t1', { status: 'completed', summary: 'Done' });

    const updated = useBackgroundTaskStore.getState().tasks['t1'];
    expect(updated.status).toBe('completed');
    expect(updated.summary).toBe('Done');
  });

  it('auto-removes terminal task added directly', () => {
    useBackgroundTaskStore.getState().addTask(makeTask('t1', 'sess-1', 'completed'));

    vi.advanceTimersByTime(15_000);

    expect(useBackgroundTaskStore.getState().tasks['t1']).toBeUndefined();
  });

  it('auto-removes task after update to terminal status', () => {
    useBackgroundTaskStore.getState().addTask(makeTask('t1'));
    useBackgroundTaskStore.getState().updateTask('t1', { status: 'completed' });

    vi.advanceTimersByTime(15_000);

    expect(useBackgroundTaskStore.getState().tasks['t1']).toBeUndefined();
  });

  it('removeTask removes a task', () => {
    useBackgroundTaskStore.setState({ tasks: { t1: makeTask('t1'), t2: makeTask('t2') } });
    useBackgroundTaskStore.getState().removeTask('t1');

    expect(useBackgroundTaskStore.getState().tasks['t1']).toBeUndefined();
    expect(useBackgroundTaskStore.getState().tasks['t2']).toBeDefined();
  });

  it('clearTasks clears all tasks when no sessionId', () => {
    useBackgroundTaskStore.setState({ tasks: { t1: makeTask('t1'), t2: makeTask('t2') } });
    useBackgroundTaskStore.getState().clearTasks();

    expect(Object.keys(useBackgroundTaskStore.getState().tasks)).toHaveLength(0);
  });

  it('clearTasks clears only tasks for given sessionId', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1', 'sess-1'),
        t2: makeTask('t2', 'sess-2'),
        t3: makeTask('t3', 'sess-1'),
      },
    });
    useBackgroundTaskStore.getState().clearTasks('sess-1');

    const remaining = useBackgroundTaskStore.getState().tasks;
    expect(Object.keys(remaining)).toEqual(['t2']);
  });

  it('getTasksBySession returns tasks for session', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        t1: makeTask('t1', 'sess-1'),
        t2: makeTask('t2', 'sess-2'),
        t3: makeTask('t3', 'sess-1'),
      },
    });

    const tasks = useBackgroundTaskStore.getState().getTasksBySession('sess-1');
    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.id).sort()).toEqual(['t1', 't3']);
  });

  it('getTasksBySession returns empty for unknown session', () => {
    expect(useBackgroundTaskStore.getState().getTasksBySession('unknown')).toEqual([]);
  });

  it('starts PID monitor when an existing running task gains a PID', async () => {
    mockGetProcessInfo.mockResolvedValue({ alive: false, pid: 71100 });
    useBackgroundTaskStore.getState().addTask({
      ...makeTask('t1'),
      serverId: 'server-1',
    });

    useBackgroundTaskStore.getState().updateTask('t1', { taskRootPid: 71100 });
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockGetProcessInfo).toHaveBeenCalledWith(71100, 'server-1');
    expect(useBackgroundTaskStore.getState().tasks.t1.status).toBe('stopped');
  });

  it('auto-removes running task after monitored PID exits', async () => {
    mockGetProcessInfo.mockResolvedValue({ alive: false, pid: 71100 });

    useBackgroundTaskStore.getState().addTask({
      ...makeTask('t1'),
      taskRootPid: 71100,
    });

    await vi.advanceTimersByTimeAsync(10_000);
    expect(useBackgroundTaskStore.getState().tasks.t1.status).toBe('stopped');

    await vi.advanceTimersByTimeAsync(15_000);
    expect(useBackgroundTaskStore.getState().tasks.t1).toBeUndefined();
  });
});
