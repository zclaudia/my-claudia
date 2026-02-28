import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockApprovePlan = vi.fn();
const mockUpdateSupervision = vi.fn();

vi.mock('../../services/api', () => ({
  approvePlan: (...args: unknown[]) => mockApprovePlan(...args),
}));

vi.mock('../../stores/supervisionStore', () => ({
  useSupervisionStore: {
    getState: () => ({
      updateSupervision: mockUpdateSupervision,
    }),
  },
}));

import { PlanReviewDialog } from '../PlanReviewDialog';

describe('PlanReviewDialog', () => {
  const defaultPlan = {
    goal: 'Build authentication',
    subtasks: [
      { description: 'Setup JWT', phase: 1, acceptanceCriteria: ['Tokens generated'] },
      { description: 'Create login endpoint', phase: 1, acceptanceCriteria: [] },
      { description: 'Add middleware', phase: 2, acceptanceCriteria: ['Routes protected'] },
    ],
    acceptanceCriteria: ['All endpoints secured', 'Tests pass'],
  };

  const defaultProps = {
    supervisionId: 'sup-123',
    plan: defaultPlan,
    isOpen: true,
    onClose: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('returns null when isOpen is false', () => {
    const { container } = render(
      <PlanReviewDialog {...defaultProps} isOpen={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with "Review Plan" header', () => {
    render(<PlanReviewDialog {...defaultProps} />);
    expect(screen.getByText('Review Plan')).toBeInTheDocument();
  });

  it('populates goal from plan', () => {
    render(<PlanReviewDialog {...defaultProps} />);
    const textarea = screen.getByDisplayValue('Build authentication');
    expect(textarea).toBeInTheDocument();
  });

  it('displays all subtasks', () => {
    render(<PlanReviewDialog {...defaultProps} />);
    expect(screen.getByDisplayValue('Setup JWT')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Create login endpoint')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Add middleware')).toBeInTheDocument();
  });

  it('displays acceptance criteria', () => {
    render(<PlanReviewDialog {...defaultProps} />);
    expect(screen.getByDisplayValue('All endpoints secured')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Tests pass')).toBeInTheDocument();
  });

  it('shows "Back to Chat" and "Approve & Start" buttons', () => {
    render(<PlanReviewDialog {...defaultProps} />);
    expect(screen.getByText('Back to Chat')).toBeInTheDocument();
    expect(screen.getByText('Approve & Start')).toBeInTheDocument();
  });

  it('calls onClose when "Back to Chat" is clicked', () => {
    render(<PlanReviewDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Back to Chat'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('calls approvePlan with plan data on approve', async () => {
    const mockSupervision = { id: 'sup-123', sessionId: 's-1', status: 'active' };
    mockApprovePlan.mockResolvedValue(mockSupervision);

    render(<PlanReviewDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Approve & Start'));

    await waitFor(() => {
      expect(mockApprovePlan).toHaveBeenCalledWith('sup-123', expect.objectContaining({
        goal: 'Build authentication',
        subtasks: expect.arrayContaining([
          expect.objectContaining({ description: 'Setup JWT', phase: 1 }),
        ]),
      }));
    });

    await waitFor(() => {
      expect(mockUpdateSupervision).toHaveBeenCalledWith(mockSupervision);
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('disables approve button when goal is empty', () => {
    render(
      <PlanReviewDialog
        {...defaultProps}
        plan={{ ...defaultPlan, goal: '' }}
      />
    );

    expect(screen.getByText('Approve & Start')).toBeDisabled();
  });

  it('shows error when approvePlan fails', async () => {
    mockApprovePlan.mockRejectedValue(new Error('Plan approval failed'));

    render(<PlanReviewDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Approve & Start'));

    await waitFor(() => {
      expect(screen.getByText('Plan approval failed')).toBeInTheDocument();
    });
  });

  it('allows editing goal text', () => {
    render(<PlanReviewDialog {...defaultProps} />);
    const textarea = screen.getByDisplayValue('Build authentication');
    fireEvent.change(textarea, { target: { value: 'Updated goal' } });
    expect(screen.getByDisplayValue('Updated goal')).toBeInTheDocument();
  });

  it('allows removing a subtask', () => {
    render(<PlanReviewDialog {...defaultProps} />);
    expect(screen.getByDisplayValue('Setup JWT')).toBeInTheDocument();

    // Find the subtask input and its row's remove button
    const subtaskInput = screen.getByDisplayValue('Setup JWT');
    const row = subtaskInput.closest('.flex.items-center.gap-2');
    const removeBtn = row?.querySelector('button');
    expect(removeBtn).toBeTruthy();
    fireEvent.click(removeBtn!);

    expect(screen.queryByDisplayValue('Setup JWT')).not.toBeInTheDocument();
  });

  it('allows adding a subtask', () => {
    render(<PlanReviewDialog {...defaultProps} />);

    const addButton = screen.getByText('+ Add Subtask');
    fireEvent.click(addButton);

    // Should have 4 subtask containers now (3 original + 1 new)
    const subtaskContainers = document.querySelectorAll('.border.border-border.rounded.p-2');
    expect(subtaskContainers).toHaveLength(4);
  });

  it('sends edited goal when approving', async () => {
    const mockSupervision = { id: 'sup-123', sessionId: 's-1', status: 'active' };
    mockApprovePlan.mockResolvedValue(mockSupervision);

    render(<PlanReviewDialog {...defaultProps} />);

    const textarea = screen.getByDisplayValue('Build authentication');
    fireEvent.change(textarea, { target: { value: 'Revised auth goal' } });
    fireEvent.click(screen.getByText('Approve & Start'));

    await waitFor(() => {
      expect(mockApprovePlan).toHaveBeenCalledWith('sup-123', expect.objectContaining({
        goal: 'Revised auth goal',
      }));
    });
  });

  it('renders with empty acceptance criteria', () => {
    render(
      <PlanReviewDialog
        {...defaultProps}
        plan={{ ...defaultPlan, acceptanceCriteria: undefined }}
      />
    );
    expect(screen.getByText(/No acceptance criteria/)).toBeInTheDocument();
  });

  it('renders with empty subtasks', () => {
    render(
      <PlanReviewDialog
        {...defaultProps}
        plan={{ ...defaultPlan, subtasks: [] }}
      />
    );
    expect(screen.getByText('No subtasks defined.')).toBeInTheDocument();
  });
});
