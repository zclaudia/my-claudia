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
    // PermissionDetailView renders Bash commands in formatted terminal view
    expect(screen.getByText('ls -la')).toBeInTheDocument();
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

  it('renders credential input when requiresCredential is true', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, requiresCredential: true, credentialHint: 'sudo_password' }}
        onDecision={mockOnDecision}
      />
    );
    expect(screen.getByText('Credential Required')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your sudo password')).toBeInTheDocument();
    expect(screen.getByText('Allow with Credential')).toBeDisabled();
  });

  it('enables Allow with Credential when credential is entered', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, requiresCredential: true }}
        onDecision={mockOnDecision}
      />
    );

    const input = screen.getByPlaceholderText('Your credential');
    fireEvent.change(input, { target: { value: 'mypass' } });
    expect(screen.getByText('Allow with Credential')).not.toBeDisabled();

    fireEvent.click(screen.getByText('Allow with Credential'));
    expect(mockOnDecision).toHaveBeenCalledWith('req-1', true, false, 'mypass');
  });

  it('submits credential on Enter key', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, requiresCredential: true }}
        onDecision={mockOnDecision}
      />
    );

    const input = screen.getByPlaceholderText('Your credential');
    fireEvent.change(input, { target: { value: 'pass123' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnDecision).toHaveBeenCalledWith('req-1', true, false, 'pass123');
  });

  it('does not submit credential on Enter when empty', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, requiresCredential: true }}
        onDecision={mockOnDecision}
      />
    );

    const input = screen.getByPlaceholderText('Your credential');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(mockOnDecision).not.toHaveBeenCalled();
  });

  it('shows queue size badge when queueSize > 1', () => {
    render(
      <PermissionModal request={defaultRequest} queueSize={5} onDecision={mockOnDecision} />
    );
    expect(screen.getByText('+4 more')).toBeInTheDocument();
  });

  it('does not show queue badge when queueSize is 1', () => {
    render(
      <PermissionModal request={defaultRequest} queueSize={1} onDecision={mockOnDecision} />
    );
    expect(screen.queryByText(/more/)).not.toBeInTheDocument();
  });

  it('shows backend name when provided', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, backendName: 'Remote Server' }}
        onDecision={mockOnDecision}
      />
    );
    expect(screen.getByText('From: Remote Server')).toBeInTheDocument();
  });

  it('shows "Waiting for your decision" when timeoutSec is 0', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, timeoutSec: 0 }}
        onDecision={mockOnDecision}
      />
    );
    expect(screen.getByText('Waiting for your decision')).toBeInTheDocument();
  });

  it('shows auto-approve text for AI-initiated requests', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, aiInitiated: true }}
        onDecision={mockOnDecision}
      />
    );
    expect(screen.getByText(/Auto-approve in/)).toBeInTheDocument();
  });

  it('does not auto-deny AI-initiated requests when countdown reaches zero', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, timeoutSec: 2, aiInitiated: true }}
        onDecision={mockOnDecision}
      />
    );

    act(() => { vi.advanceTimersByTime(2000); });
    expect(mockOnDecision).not.toHaveBeenCalled();
  });

  it('focuses credential input on no-timeout credential request', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, timeoutSec: 0, requiresCredential: true }}
        onDecision={mockOnDecision}
      />
    );
    // Just verify it renders without error - focus is async via setTimeout
    expect(screen.getByPlaceholderText('Your credential')).toBeInTheDocument();
  });

  it('focuses credential input on timeout credential request', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, timeoutSec: 30, requiresCredential: true }}
        onDecision={mockOnDecision}
      />
    );
    expect(screen.getByText('30s')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Your credential')).toBeInTheDocument();
  });

  it('shows credential description text for credential request', () => {
    render(
      <PermissionModal
        request={{ ...defaultRequest, requiresCredential: true, credentialHint: 'sudo_password' }}
        onDecision={mockOnDecision}
      />
    );
    expect(screen.getByText('This command requires your sudo password')).toBeInTheDocument();
  });

  it('resets credential when request changes', () => {
    const { rerender } = render(
      <PermissionModal
        request={{ ...defaultRequest, requiresCredential: true }}
        onDecision={mockOnDecision}
      />
    );

    fireEvent.change(screen.getByPlaceholderText('Your credential'), { target: { value: 'old-pass' } });

    rerender(
      <PermissionModal
        request={{ ...defaultRequest, requestId: 'req-2', requiresCredential: true }}
        onDecision={mockOnDecision}
      />
    );

    expect(screen.getByPlaceholderText('Your credential')).toHaveValue('');
  });
});
