import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';

const mockStartSupervisionPlanning = vi.fn();
const mockCreateSupervision = vi.fn();
const mockUpdateSupervision = vi.fn();
const mockSetPendingHint = vi.fn();

vi.mock('../../services/api', () => ({
  startSupervisionPlanning: (...args: unknown[]) => mockStartSupervisionPlanning(...args),
  createSupervision: (...args: unknown[]) => mockCreateSupervision(...args),
}));

vi.mock('../../stores/supervisionStore', () => ({
  useSupervisionStore: {
    getState: () => ({
      updateSupervision: mockUpdateSupervision,
      setPendingHint: mockSetPendingHint,
    }),
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

  it('shows disabled buttons when goal is empty', () => {
    render(<SuperviseDialog {...defaultProps} />);
    expect(screen.getByText('Quick Start')).toBeDisabled();
    expect(screen.getByText('AI Planning')).toBeDisabled();
  });

  it('enables buttons when goal has text', () => {
    render(<SuperviseDialog {...defaultProps} />);
    const textarea = screen.getByPlaceholderText(
      'Describe what this session should achieve...'
    );
    fireEvent.change(textarea, { target: { value: 'My goal' } });

    expect(screen.getByText('Quick Start')).not.toBeDisabled();
    expect(screen.getByText('AI Planning')).not.toBeDisabled();
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

    // The remove button is inside the list item
    const subtaskItem = screen.getByText('Task to remove').closest('li');
    const removeButton = subtaskItem?.querySelector('button');
    expect(removeButton).toBeTruthy();
    fireEvent.click(removeButton!);

    expect(screen.queryByText('Task to remove')).not.toBeInTheDocument();
  });

  it('toggles Settings section', () => {
    render(<SuperviseDialog {...defaultProps} />);

    expect(screen.queryByText('Max iterations')).not.toBeInTheDocument();
    expect(screen.queryByText('Cooldown (sec)')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('Settings'));

    expect(screen.getByText('Max iterations')).toBeInTheDocument();
    expect(screen.getByText('Cooldown (sec)')).toBeInTheDocument();
  });

  it('Quick Start creates supervision with correct params', async () => {
    const mockSupervision = { id: 'sup-1', sessionId: 'session-123', goal: 'Test goal' };
    mockCreateSupervision.mockResolvedValue(mockSupervision);

    render(<SuperviseDialog {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(
      'Describe what this session should achieve...'
    );
    fireEvent.change(textarea, { target: { value: 'Test goal' } });
    fireEvent.click(screen.getByText('Quick Start'));

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

  it('AI Planning starts planning session, sets pending hint and closes dialog', async () => {
    const mockSupervision = { id: 'sup-1', sessionId: 'session-123', status: 'planning' };
    mockStartSupervisionPlanning.mockResolvedValue({
      supervision: mockSupervision,
    });

    render(<SuperviseDialog {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(
      'Describe what this session should achieve...'
    );
    fireEvent.change(textarea, { target: { value: 'Build a feature' } });
    fireEvent.click(screen.getByText('AI Planning'));

    await waitFor(() => {
      expect(mockStartSupervisionPlanning).toHaveBeenCalledWith({
        sessionId: 'session-123',
        hint: 'Build a feature',
      });
    });

    await waitFor(() => {
      expect(mockUpdateSupervision).toHaveBeenCalledWith(mockSupervision);
      expect(mockSetPendingHint).toHaveBeenCalledWith('session-123', 'Build a feature');
      expect(defaultProps.onClose).toHaveBeenCalled();
    });
  });

  it('Cancel button calls onClose', () => {
    render(<SuperviseDialog {...defaultProps} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('displays error when Quick Start fails', async () => {
    mockCreateSupervision.mockRejectedValue(new Error('Server error'));

    render(<SuperviseDialog {...defaultProps} />);

    const textarea = screen.getByPlaceholderText(
      'Describe what this session should achieve...'
    );
    fireEvent.change(textarea, { target: { value: 'Failing goal' } });
    fireEvent.click(screen.getByText('Quick Start'));

    await waitFor(() => {
      expect(screen.getByText('Server error')).toBeInTheDocument();
    });
  });
});
