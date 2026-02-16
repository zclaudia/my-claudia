import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { PermissionModal } from '../PermissionModal';

describe('PermissionModal', () => {
  const mockOnDecision = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const defaultRequest = {
    requestId: 'req-1',
    toolName: 'Bash',
    detail: '{"command": "ls -la"}',
    timeoutSec: 60,
  };

  it('returns null when request is null', () => {
    const { container } = render(
      <PermissionModal request={null} onDecision={mockOnDecision} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders modal when request is provided', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    expect(screen.getByText('Permission Required')).toBeInTheDocument();
    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('{"command": "ls -la"}')).toBeInTheDocument();
  });

  it('displays tool name correctly', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, toolName: 'Write' }}
        onDecision={mockOnDecision}
      />
    );

    expect(screen.getByText('Write')).toBeInTheDocument();
  });

  it('displays detail correctly', () => {
    const detail = 'Some long detail text here';
    render(
      <PermissionModal
        request={{ ...defaultRequest, detail }}
        onDecision={mockOnDecision}
      />
    );

    expect(screen.getByText(detail)).toBeInTheDocument();
  });

  it('shows initial countdown timer', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    expect(screen.getByText('60s')).toBeInTheDocument();
  });

  it('countdown decrements every second', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    expect(screen.getByText('60s')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(screen.getByText('59s')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByText('54s')).toBeInTheDocument();
  });

  it('auto-denies when countdown reaches zero', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, timeoutSec: 3 }}
        onDecision={mockOnDecision}
      />
    );

    expect(mockOnDecision).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(mockOnDecision).toHaveBeenCalledWith('req-1', false);
  });

  it('calls onDecision with allow=true when Allow clicked', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    fireEvent.click(screen.getByText('Allow'));

    expect(mockOnDecision).toHaveBeenCalledWith('req-1', true, false);
  });

  it('calls onDecision with allow=false when Deny clicked', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    fireEvent.click(screen.getByText('Deny'));

    expect(mockOnDecision).toHaveBeenCalledWith('req-1', false, false);
  });

  it('includes remember flag when checkbox is checked and Allow clicked', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByText('Allow'));

    expect(mockOnDecision).toHaveBeenCalledWith('req-1', true, true);
  });

  it('includes remember flag when checkbox is checked and Deny clicked', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByText('Deny'));

    expect(mockOnDecision).toHaveBeenCalledWith('req-1', false, true);
  });

  it('resets remember checkbox when request changes', () => {
    const { rerender } = render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    // Check the remember checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    // Change request
    rerender(
      <PermissionModal
        request={{ ...defaultRequest, requestId: 'req-2' }}
        onDecision={mockOnDecision}
      />
    );

    // Checkbox should be reset
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('resets countdown when request changes', () => {
    const { rerender } = render(
      <PermissionModal
        request={{ ...defaultRequest, timeoutSec: 60 }}
        onDecision={mockOnDecision}
      />
    );

    // Advance time
    act(() => {
      vi.advanceTimersByTime(30000);
    });
    expect(screen.getByText('30s')).toBeInTheDocument();

    // Change request with new timeout
    rerender(
      <PermissionModal
        request={{ ...defaultRequest, requestId: 'req-2', timeoutSec: 120 }}
        onDecision={mockOnDecision}
      />
    );

    // Timer should be reset to new timeout
    expect(screen.getByText('120s')).toBeInTheDocument();
  });

  it('displays warning text about auto-deny', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    expect(screen.getByText(/Auto-deny in/)).toBeInTheDocument();
  });

  it('shows description text about tool approval', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    expect(
      screen.getByText('Claude wants to use a tool that requires your approval')
    ).toBeInTheDocument();
  });

  it('shows remember checkbox label', () => {
    render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    expect(
      screen.getByText('Remember this decision for this session')
    ).toBeInTheDocument();
  });

  it('cleans up interval on unmount', () => {
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');

    const { unmount } = render(
      <PermissionModal request={defaultRequest} onDecision={mockOnDecision} />
    );

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalled();
    clearIntervalSpy.mockRestore();
  });
});
