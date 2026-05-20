import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { PlanReviewInteractionMessage } from '@my-claudia/shared';

const sendMessage = vi.fn();
const createIssue = vi.fn();
const mockProjectId = 'proj-1';

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({ sendMessage }),
}));

vi.mock('../../local-issues/store', () => ({
  useLocalIssueStore: (selector?: (s: { createIssue: typeof createIssue }) => unknown) =>
    selector ? selector({ createIssue }) : { createIssue },
}));

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: {
    getState: () => ({
      sessions: [{ id: 'session-1', projectId: mockProjectId }],
    }),
  },
}));

import { InteractionItem } from '../InteractionItem';

const interaction: PlanReviewInteractionMessage = {
  type: 'interaction_plan_review',
  interactionId: 'i-1',
  sessionId: 'session-1',
  source: 'tool_call',
  createdAt: 0,
  plan: '# Refactor auth\n\nDo the thing.',
};

beforeEach(() => {
  sendMessage.mockReset();
  createIssue.mockReset();
});

describe('PlanReviewRenderer — save as issue', () => {
  it('renders a Save as Issue button alongside Approve and Deny', () => {
    render(<InteractionItem interaction={interaction} />);
    expect(screen.getByRole('button', { name: /save as issue/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
  });

  it('opens dialog with extracted default title when Save as Issue is clicked', () => {
    render(<InteractionItem interaction={interaction} />);
    fireEvent.click(screen.getByRole('button', { name: /save as issue/i }));
    const input = screen.getByLabelText(/title/i) as HTMLInputElement;
    expect(input.value).toBe('Refactor auth');
  });

  it('on save: creates an actionable issue, then sends deny with the issue id in feedback', async () => {
    createIssue.mockResolvedValue({
      id: 'iss-42',
      projectId: mockProjectId,
      title: 'Refactor auth',
      description: interaction.plan,
      status: 'open',
      priority: 'medium',
      labels: ['actionable'],
      createdAt: 0,
      updatedAt: 0,
    });

    render(<InteractionItem interaction={interaction} />);
    fireEvent.click(screen.getByRole('button', { name: /save as issue/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() => {
      expect(createIssue).toHaveBeenCalledWith(mockProjectId, {
        title: 'Refactor auth',
        description: interaction.plan,
        labels: ['actionable'],
      });
    });

    await waitFor(() => {
      expect(sendMessage).toHaveBeenCalledWith({
        type: 'interaction_response',
        interactionId: 'i-1',
        sessionId: 'session-1',
        response: {
          approved: false,
          feedback: 'Saved as issue #iss-42 for later.',
        },
      });
    });
  });

  it('on save: renders a "saved as issue" terminal state', async () => {
    createIssue.mockResolvedValue({
      id: 'iss-42',
      projectId: mockProjectId,
      title: 'Refactor auth',
      description: interaction.plan,
      status: 'open',
      priority: 'medium',
      labels: ['actionable'],
      createdAt: 0,
      updatedAt: 0,
    });
    render(<InteractionItem interaction={interaction} />);
    fireEvent.click(screen.getByRole('button', { name: /save as issue/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    expect(await screen.findByText(/saved as issue #iss-42/i)).toBeInTheDocument();
  });

  it('on save failure: stays pending, does not call sendMessage', async () => {
    createIssue.mockRejectedValue(new Error('boom'));
    render(<InteractionItem interaction={interaction} />);
    fireEvent.click(screen.getByRole('button', { name: /save as issue/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(createIssue).toHaveBeenCalled());
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
  });

  it('disables Approve/Deny/Save while a save is in-flight (prevents duplicate responses)', async () => {
    let resolveCreate: (issue: unknown) => void;
    createIssue.mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );

    render(<InteractionItem interaction={interaction} />);
    fireEvent.click(screen.getByRole('button', { name: /save as issue/i }));
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    // Mid-flight: dialog dismissed (simulate cancel), outer buttons should now be disabled.
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /deny/i })).toBeDisabled();
      expect(screen.getByRole('button', { name: /save as issue/i })).toBeDisabled();
    });

    // Clicking a disabled button must not trigger sendMessage.
    fireEvent.click(screen.getByRole('button', { name: /deny/i }));
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(sendMessage).not.toHaveBeenCalled();

    // Resolving the save eventually fires the deny+savedAsIssue response exactly once.
    resolveCreate!({
      id: 'iss-99',
      projectId: mockProjectId,
      title: 'Refactor auth',
      description: interaction.plan,
      status: 'open',
      priority: 'medium',
      labels: ['actionable'],
      createdAt: 0,
      updatedAt: 0,
    });

    await waitFor(() => expect(sendMessage).toHaveBeenCalledTimes(1));
    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        response: { approved: false, feedback: 'Saved as issue #iss-99 for later.' },
      }),
    );
  });
});
