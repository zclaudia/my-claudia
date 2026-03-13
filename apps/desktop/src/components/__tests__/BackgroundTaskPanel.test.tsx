import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
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
});
