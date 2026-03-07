import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';

const mockGetSupervisionV2Logs = vi.fn();
let mockLastCheckpoint: Record<string, string> = {};

vi.mock('../../../services/api', () => ({
  getSupervisionV2Logs: (...args: unknown[]) => mockGetSupervisionV2Logs(...args),
}));

vi.mock('../../../stores/supervisionStore', () => ({
  useSupervisionStore: (selector: (s: any) => any) => {
    const state = { lastCheckpoint: mockLastCheckpoint };
    return selector(state);
  },
}));

import { CheckpointFeed } from '../CheckpointFeed';

describe('CheckpointFeed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLastCheckpoint = {};
  });

  afterEach(() => {
    cleanup();
  });

  it('shows "No checkpoint activity yet" when no logs', async () => {
    mockGetSupervisionV2Logs.mockResolvedValue([]);

    render(<CheckpointFeed projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('No checkpoint activity yet')).toBeInTheDocument();
    });
  });

  it('renders checkpoint header', () => {
    mockGetSupervisionV2Logs.mockResolvedValue([]);

    render(<CheckpointFeed projectId="proj-1" />);
    expect(screen.getByText('Checkpoints')).toBeInTheDocument();
  });

  it('shows last checkpoint summary when available', async () => {
    mockGetSupervisionV2Logs.mockResolvedValue([]);
    mockLastCheckpoint = { 'proj-1': 'Completed 3 tasks successfully' };

    render(<CheckpointFeed projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Completed 3 tasks successfully')).toBeInTheDocument();
    });
  });

  it('renders checkpoint log entries', async () => {
    mockGetSupervisionV2Logs.mockResolvedValue([
      {
        id: 'log-1',
        projectId: 'proj-1',
        event: 'checkpoint_completed',
        createdAt: Date.now(),
      },
      {
        id: 'log-2',
        projectId: 'proj-1',
        event: 'task_created',
        createdAt: Date.now(),
      },
    ]);

    render(<CheckpointFeed projectId="proj-1" />);

    await waitFor(() => {
      // checkpoint_completed maps to 'Checkpoint' in formatEventLabel
      expect(screen.getByText('Checkpoint')).toBeInTheDocument();
      // task_created is not in the labels map, so falls back to "task created"
      expect(screen.getByText('task created')).toBeInTheDocument();
    });
  });

  it('filters logs to only checkpoint-related events', async () => {
    mockGetSupervisionV2Logs.mockResolvedValue([
      { id: 'log-1', projectId: 'proj-1', event: 'checkpoint_completed', createdAt: Date.now() },
      { id: 'log-2', projectId: 'proj-1', event: 'agent_initialized', createdAt: Date.now() },
      { id: 'log-3', projectId: 'proj-1', event: 'context_updated', createdAt: Date.now() },
    ]);

    render(<CheckpointFeed projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Checkpoint')).toBeInTheDocument();
      // context_updated is not in the labels map, falls back to "context updated"
      expect(screen.getByText('context updated')).toBeInTheDocument();
      // agent_initialized should be filtered out (not checkpoint-related)
      expect(screen.queryByText('Agent Init')).not.toBeInTheDocument();
    });
  });

  it('renders log detail when available', async () => {
    mockGetSupervisionV2Logs.mockResolvedValue([
      {
        id: 'log-1',
        projectId: 'proj-1',
        event: 'checkpoint_completed',
        detail: 'Some detail text',
        createdAt: Date.now(),
      },
    ]);

    render(<CheckpointFeed projectId="proj-1" />);

    await waitFor(() => {
      expect(screen.getByText('Some detail text')).toBeInTheDocument();
    });
  });

  it('calls getSupervisionV2Logs with correct project and limit', () => {
    mockGetSupervisionV2Logs.mockResolvedValue([]);

    render(<CheckpointFeed projectId="proj-1" />);

    expect(mockGetSupervisionV2Logs).toHaveBeenCalledWith('proj-1', 50);
  });
});
