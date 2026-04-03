import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { TaskCardStrip } from '../TaskCardStrip';
import { useSupervisionStore } from '../../store';

const { mockGetSupervisionTasks } = vi.hoisted(() => ({
  mockGetSupervisionTasks: vi.fn(() => new Promise(() => {})),
}));

vi.mock('../../../../services/api', () => ({
  getSupervisionTasks: mockGetSupervisionTasks,
  openTaskSession: vi.fn(),
  getSessions: vi.fn().mockResolvedValue([]),
  retryTask: vi.fn(),
  cancelTask: vi.fn(),
  runTaskNow: vi.fn(),
}));

vi.mock('../../../../stores/projectStore', () => ({
  useProjectStore: Object.assign(
    (sel: any) => {
      const state = { sessions: [], setSessions: vi.fn(), selectSession: vi.fn() };
      return typeof sel === 'function' ? sel(state) : state;
    },
    { getState: () => ({ sessions: [], setSessions: vi.fn(), selectSession: vi.fn() }) },
  ),
}));

describe('TaskCardStrip', () => {
  beforeEach(() => {
    mockGetSupervisionTasks.mockImplementation(() => new Promise(() => {}));
    useSupervisionStore.setState({ tasks: {}, agents: {}, lastCheckpoint: {} });
  });

  it('returns null when no tasks', () => {
    const { container } = render(<TaskCardStrip projectId="p1" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders task cards', () => {
    useSupervisionStore.setState({
      tasks: {
        p1: [{
          id: 't1',
          projectId: 'p1',
          title: 'Fix bug',
          status: 'running',
          source: 'user',
          priority: 0,
          dependencies: [],
          dependencyMode: 'all',
          acceptanceCriteria: [],
          maxRetries: 2,
          attempt: 1,
          createdAt: Date.now(),
        }],
      },
    } as any);
    const { getByText } = render(<TaskCardStrip projectId="p1" />);
    expect(getByText('Fix bug')).toBeTruthy();
    expect(getByText('Tasks (1)')).toBeTruthy();
  });
});
