import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { BackgroundTaskPanel } from '../BackgroundTaskPanel';
import { useBackgroundTaskStore } from '../../stores/backgroundTaskStore';

describe('BackgroundTaskPanel', () => {
  beforeEach(() => {
    useBackgroundTaskStore.setState({ tasks: {} });
  });

  it('returns null when no tasks', () => {
    const { container } = render(<BackgroundTaskPanel sessionId="s1" />);
    expect(container.innerHTML).toBe('');
  });

  it('renders tasks for the session', () => {
    useBackgroundTaskStore.setState({
      tasks: {
        't1': {
          id: 't1',
          sessionId: 's1',
          status: 'in_progress',
          description: 'Running task',
          startedAt: Date.now(),
        },
      },
    } as any);
    const { getByText } = render(<BackgroundTaskPanel sessionId="s1" />);
    expect(getByText('Running task')).toBeTruthy();
    expect(getByText('1 task running')).toBeTruthy();
  });

  it('shows stop only for stoppable sdk tasks', () => {
    const onStopTask = vi.fn();
    useBackgroundTaskStore.setState({
      tasks: {
        'sdk-task': {
          id: 'sdk-task',
          sessionId: 's1',
          status: 'in_progress',
          description: 'SDK task',
          source: 'sdk_task',
          stoppable: true,
          startedAt: Date.now(),
        },
        'background:s2': {
          id: 'background:s2',
          sessionId: 's1',
          status: 'in_progress',
          description: 'Background run',
          source: 'background_run',
          stoppable: false,
          startedAt: Date.now(),
        },
      },
    } as any);

    const { getByTitle, queryAllByTitle } = render(
      <BackgroundTaskPanel sessionId="s1" onStopTask={onStopTask} />
    );

    expect(queryAllByTitle('Stop this task')).toHaveLength(1);
    fireEvent.click(getByTitle('Stop this task'));
    expect(onStopTask).toHaveBeenCalledWith('sdk-task');
  });
});
