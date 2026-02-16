import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockPlanSupervision = vi.fn();
const mockCreateSupervision = vi.fn();
const mockUpdateSupervision = vi.fn();

vi.mock('../../services/api', () => ({
  planSupervision: (...args: unknown[]) => mockPlanSupervision(...args),
  createSupervision: (...args: unknown[]) => mockCreateSupervision(...args),
}));

vi.mock('../../stores/supervisionStore', () => ({
  useSupervisionStore: {
    getState: () => ({ updateSupervision: mockUpdateSupervision }),
  },
}));

import { SuperviseDialog } from '../SuperviseDialog';

describe('SuperviseDialog', () => {
  const defaultProps = {
    sessionId: 'session-123',
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
      <SuperviseDialog {...defaultProps} isOpen={false} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when sessionId is null', () => {
    const { container } = render(
      <SuperviseDialog {...defaultProps} sessionId={null} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with header "Supervise Session" when open', () => {
    render(<SuperviseDialog {...defaultProps} />);
    expect(screen.getByText('Supervise Session')).toBeInTheDocument();
  });

  it('shows Goal textarea with correct placeholder', () => {
    render(<SuperviseDialog {...defaultProps} />);
    expect(
      screen.getByPlaceholderText('Describe what this session should achieve...')
    ).toBeInTheDocument();
  });

  it('shows disabled "Start Supervision" button when goal is empty', () => {
    render(<SuperviseDialog {...defaultProps} />);
    const startButton = screen.getByText('Start Supervision');
    expect(startButton).toBeDisabled();
  });

  it('enables "Start Supervision" when goal has text', () => {
    render(<SuperviseDialog {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(
      'Describe what this session should achieve...'
    );
    fireEvent.change(textarea, { target: { value: 'My goal' } });

    const startButton = screen.getByText('Start Supervision');
    expect(startButton).not.toBeDisabled();
  });

  it('adds a subtask when typing in input and clicking Add', () => {
    render(<SuperviseDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText('Add a subtask...');
    fireEvent.change(input, { target: { value: 'First subtask' } });
    fireEvent.click(screen.getByText('Add'));

    expect(screen.getByText('First subtask')).toBeInTheDocument();
  });

  it('adds a subtask via Enter key', () => {
    render(<SuperviseDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText('Add a subtask...');
    fireEvent.change(input, { target: { value: 'Enter subtask' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });

    expect(screen.getByText('Enter subtask')).toBeInTheDocument();
  });

  it('removes a subtask when clicking the remove button', () => {
    render(<SuperviseDialog {...defaultProps} />);
    const input = screen.getByPlaceholderText('Add a subtask...');

    // Add a subtask
    fireEvent.change(input, { target: { value: 'Task to remove' } });
    fireEvent.click(screen.getByText('Add'));
    expect(screen.getByText('Task to remove')).toBeInTheDocument();

    // The remove button is inside the list item, find the button with the X SVG
    const subtaskItem = screen.getByText('Task to remove').closest('li');
    const removeButton = subtaskItem?.querySelector('button');
    expect(removeButton).toBeTruthy();
    fireEvent.click(removeButton!);

    expect(screen.queryByText('Task to remove')).not.toBeInTheDocument();
  });

  it('toggles Settings section to show Max iterations and Cooldown labels', () => {
    render(<SuperviseDialog {...defaultProps} />);

    // Settings labels should not be visible initially
    expect(screen.queryByText('Max iterations')).not.toBeInTheDocument();
    expect(screen.queryByText('Cooldown (sec)')).not.toBeInTheDocument();

    // Click the Settings toggle
    fireEvent.click(screen.getByText('Settings'));

    expect(screen.getByText('Max iterations')).toBeInTheDocument();
    expect(screen.getByText('Cooldown (sec)')).toBeInTheDocument();
  });

  it('"Let AI Plan" fills goal and subtasks from API response', async () => {
    mockPlanSupervision.mockResolvedValue({
      goal: 'AI planned goal',
      subtasks: ['Step 1', 'Step 2'],
      estimatedIterations: 10,
    });

    render(<SuperviseDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Let AI Plan'));

    await waitFor(() => {
      expect(mockPlanSupervision).toHaveBeenCalledWith({
        sessionId: 'session-123',
        hint: undefined,
      });
    });

    await waitFor(() => {
      const textarea = screen.getByPlaceholderText(
        'Describe what this session should achieve...'
      ) as HTMLTextAreaElement;
      expect(textarea.value).toBe('AI planned goal');
    });

    expect(screen.getByText('Step 1')).toBeInTheDocument();
    expect(screen.getByText('Step 2')).toBeInTheDocument();
  });

  it('"Let AI Plan" shows "Planning..." text while loading', async () => {
    let resolvePromise: (value: unknown) => void;
    mockPlanSupervision.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    render(<SuperviseDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Let AI Plan'));

    expect(screen.getByText('Planning...')).toBeInTheDocument();

    // Resolve so the test can clean up
    resolvePromise!({
      goal: 'Done',
      subtasks: [],
      estimatedIterations: 5,
    });

    await waitFor(() => {
      expect(screen.getByText('Let AI Plan')).toBeInTheDocument();
    });
  });

  it('calls createSupervision with correct params and onClose on Start Supervision', async () => {
    const mockSupervision = { id: 'sup-1', sessionId: 'session-123', goal: 'Test goal' };
    mockCreateSupervision.mockResolvedValue(mockSupervision);

    render(<SuperviseDialog {...defaultProps} />);

    // Enter a goal
    const textarea = screen.getByPlaceholderText(
      'Describe what this session should achieve...'
    );
    fireEvent.change(textarea, { target: { value: 'Test goal' } });

    // Click Start Supervision
    fireEvent.click(screen.getByText('Start Supervision'));

    await waitFor(() => {
      expect(mockCreateSupervision).toHaveBeenCalledWith({
        sessionId: 'session-123',
        goal: 'Test goal',
        subtasks: undefined,
        maxIterations: undefined,
        cooldownSeconds: 5,
      });
    });

    await waitFor(() => {
      expect(mockUpdateSupervision).toHaveBeenCalledWith(mockSupervision);
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('shows "Starting..." while creating supervision', async () => {
    let resolvePromise: (value: unknown) => void;
    mockCreateSupervision.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      })
    );

    render(<SuperviseDialog {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(
      'Describe what this session should achieve...'
    );
    fireEvent.change(textarea, { target: { value: 'Test goal' } });
    fireEvent.click(screen.getByText('Start Supervision'));

    expect(screen.getByText('Starting...')).toBeInTheDocument();

    // Resolve so the test can clean up
    resolvePromise!({ id: 'sup-1' });

    await waitFor(() => {
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('Cancel button calls onClose', () => {
    render(<SuperviseDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('displays error message when createSupervision rejects', async () => {
    mockCreateSupervision.mockRejectedValue(new Error('Server error'));

    render(<SuperviseDialog {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(
      'Describe what this session should achieve...'
    );
    fireEvent.change(textarea, { target: { value: 'Failing goal' } });
    fireEvent.click(screen.getByText('Start Supervision'));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });
});
