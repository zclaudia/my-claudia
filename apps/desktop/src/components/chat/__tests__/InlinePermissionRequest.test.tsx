import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { InlinePermissionRequest } from '../InlinePermissionRequest';
import { usePermissionStore, type PermissionRequest } from '../../../stores/permissionStore';

function makeRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    requestId: 'req-exit-plan-1',
    toolName: 'ExitPlanMode',
    detail: 'Exit plan mode',
    timeoutSec: 0,
    ...overrides,
  };
}

describe('InlinePermissionRequest', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    usePermissionStore.setState((state) => ({
      ...state,
      pendingRequests: [],
      pendingRequest: null,
      feedbackDrafts: {},
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('keeps feedback when parent callback reference changes', () => {
    const request = makeRequest();
    const onDecisionA = vi.fn();
    const { rerender } = render(
      <InlinePermissionRequest request={request} onDecision={onDecisionA} />
    );

    const textarea = screen.getByPlaceholderText('Why do you reject exiting plan mode?');
    fireEvent.change(textarea, { target: { value: 'Do not exit now' } });
    expect(textarea).toHaveValue('Do not exit now');

    const onDecisionB = vi.fn();
    rerender(<InlinePermissionRequest request={request} onDecision={onDecisionB} />);

    expect(screen.getByPlaceholderText('Why do you reject exiting plan mode?')).toHaveValue('Do not exit now');
  });

  it('renders permission required heading', () => {
    render(<InlinePermissionRequest request={makeRequest()} onDecision={vi.fn()} />);
    expect(screen.getByText('Permission Required')).toBeInTheDocument();
    expect(screen.getByText('ExitPlanMode')).toBeInTheDocument();
  });

  it('renders Allow and Deny buttons', () => {
    render(<InlinePermissionRequest request={makeRequest()} onDecision={vi.fn()} />);
    expect(screen.getByText('Allow')).toBeInTheDocument();
    expect(screen.getByText('Deny')).toBeInTheDocument();
  });

  it('calls onDecision with allow=true on Allow click', () => {
    const onDecision = vi.fn();
    render(<InlinePermissionRequest request={makeRequest()} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Allow'));
    expect(onDecision).toHaveBeenCalledWith('req-exit-plan-1', true, false);
  });

  it('calls onDecision with allow=false on Deny click', () => {
    const onDecision = vi.fn();
    render(<InlinePermissionRequest request={makeRequest()} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Deny'));
    expect(onDecision).toHaveBeenCalledWith('req-exit-plan-1', false, false);
  });

  it('shows resolved state after Allow', () => {
    const onDecision = vi.fn();
    render(<InlinePermissionRequest request={makeRequest()} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Allow'));
    expect(screen.getByText(/Approved/)).toBeInTheDocument();
  });

  it('shows resolved state after Deny', () => {
    const onDecision = vi.fn();
    render(<InlinePermissionRequest request={makeRequest()} onDecision={onDecision} />);
    fireEvent.click(screen.getByText('Deny'));
    expect(screen.getByText(/Denied/)).toBeInTheDocument();
  });

  it('toggles remember checkbox', () => {
    const onDecision = vi.fn();
    render(<InlinePermissionRequest request={makeRequest()} onDecision={onDecision} />);
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(checkbox).toBeChecked();

    fireEvent.click(screen.getByText('Allow'));
    expect(onDecision).toHaveBeenCalledWith('req-exit-plan-1', true, true);
  });

  it('renders credential input for requiresCredential', () => {
    const request = makeRequest({ toolName: 'Bash', requiresCredential: true, credentialHint: 'sudo_password' });
    render(<InlinePermissionRequest request={request} onDecision={vi.fn()} />);
    expect(screen.getByText('Credential Required')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter sudo password')).toBeInTheDocument();
  });

  it('disables Allow when credential is required but empty', () => {
    const request = makeRequest({ toolName: 'Bash', requiresCredential: true });
    render(<InlinePermissionRequest request={request} onDecision={vi.fn()} />);
    expect(screen.getByText('Allow')).toBeDisabled();
  });

  it('enables Allow when credential is provided', () => {
    const request = makeRequest({ toolName: 'Bash', requiresCredential: true });
    const onDecision = vi.fn();
    render(<InlinePermissionRequest request={request} onDecision={onDecision} />);

    fireEvent.change(screen.getByPlaceholderText('Enter credential'), { target: { value: 'my-pass' } });
    expect(screen.getByText('Allow')).not.toBeDisabled();

    fireEvent.click(screen.getByText('Allow'));
    expect(onDecision).toHaveBeenCalledWith('req-exit-plan-1', true, false, 'my-pass');
  });

  it('submits credential on Enter key', () => {
    const request = makeRequest({ toolName: 'Bash', requiresCredential: true });
    const onDecision = vi.fn();
    render(<InlinePermissionRequest request={request} onDecision={onDecision} />);

    const input = screen.getByPlaceholderText('Enter credential');
    fireEvent.change(input, { target: { value: 'pass123' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onDecision).toHaveBeenCalledWith('req-exit-plan-1', true, false, 'pass123');
  });

  it('shows backend name when provided', () => {
    const request = makeRequest({ backendName: 'My Server' });
    render(<InlinePermissionRequest request={request} onDecision={vi.fn()} />);
    expect(screen.getByText('My Server')).toBeInTheDocument();
  });

  it('shows Deny + Comment button for ExitPlanMode', () => {
    render(<InlinePermissionRequest request={makeRequest()} onDecision={vi.fn()} />);
    expect(screen.getByText('Deny + Comment')).toBeInTheDocument();
  });

  it('Deny + Comment is disabled when feedback is empty', () => {
    render(<InlinePermissionRequest request={makeRequest()} onDecision={vi.fn()} />);
    expect(screen.getByText('Deny + Comment')).toBeDisabled();
  });

  it('does not show Deny + Comment for non-ExitPlanMode tools', () => {
    render(<InlinePermissionRequest request={makeRequest({ toolName: 'Bash', detail: '{}' })} onDecision={vi.fn()} />);
    expect(screen.queryByText('Deny + Comment')).not.toBeInTheDocument();
  });

  it('does not show feedback textarea for non-ExitPlanMode tools', () => {
    render(<InlinePermissionRequest request={makeRequest({ toolName: 'Bash', detail: '{}' })} onDecision={vi.fn()} />);
    expect(screen.queryByPlaceholderText(/Why do you reject/)).not.toBeInTheDocument();
  });

  it('restores feedback after remount and clears it on deny with comment', () => {
    const request = makeRequest();
    const onDecision = vi.fn();

    const firstMount = render(
      <InlinePermissionRequest request={request} onDecision={onDecision} />
    );

    fireEvent.change(
      screen.getByPlaceholderText('Why do you reject exiting plan mode?'),
      { target: { value: 'Need more analysis first' } }
    );
    firstMount.unmount();

    render(<InlinePermissionRequest request={request} onDecision={onDecision} />);

    expect(screen.getByPlaceholderText('Why do you reject exiting plan mode?')).toHaveValue('Need more analysis first');

    fireEvent.click(screen.getByRole('button', { name: 'Deny + Comment' }));

    expect(onDecision).toHaveBeenCalledWith(request.requestId, false, false, undefined, 'Need more analysis first');
    expect(usePermissionStore.getState().feedbackDrafts[request.requestId]).toBeUndefined();
  });

  it('shows timeout countdown and progress bar', () => {
    const request = makeRequest({ toolName: 'Bash', detail: '{}', timeoutSec: 30 });
    render(<InlinePermissionRequest request={request} onDecision={vi.fn()} />);
    expect(screen.getByText('30s')).toBeInTheDocument();
  });

  it('decrements countdown every second', () => {
    const request = makeRequest({ toolName: 'Bash', detail: '{}', timeoutSec: 5 });
    render(<InlinePermissionRequest request={request} onDecision={vi.fn()} />);
    expect(screen.getByText('5s')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('4s')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText('3s')).toBeInTheDocument();
  });

  it('auto-denies non-AI-initiated request when countdown reaches 0', () => {
    const onDecision = vi.fn();
    const request = makeRequest({ toolName: 'Bash', detail: '{}', timeoutSec: 2, aiInitiated: false });
    render(<InlinePermissionRequest request={request} onDecision={onDecision} />);

    act(() => { vi.advanceTimersByTime(2000); });

    expect(onDecision).toHaveBeenCalledWith('req-exit-plan-1', false);
    expect(screen.getByText(/Denied/)).toBeInTheDocument();
  });

  it('does not auto-deny AI-initiated request when countdown reaches 0', () => {
    const onDecision = vi.fn();
    const request = makeRequest({ toolName: 'Bash', detail: '{}', timeoutSec: 2, aiInitiated: true });
    render(<InlinePermissionRequest request={request} onDecision={onDecision} />);

    act(() => { vi.advanceTimersByTime(2000); });

    expect(onDecision).not.toHaveBeenCalled();
  });

  it('shows auto-approve label for AI-initiated requests', () => {
    const request = makeRequest({ toolName: 'Bash', detail: '{}', timeoutSec: 10, aiInitiated: true });
    render(<InlinePermissionRequest request={request} onDecision={vi.fn()} />);
    expect(screen.getByText('Auto-approve:')).toBeInTheDocument();
  });

  it('sets timeout and focuses credential input for credential+timeout request', () => {
    const request = makeRequest({
      toolName: 'Bash',
      requiresCredential: true,
      credentialHint: 'sudo_password',
      timeoutSec: 30,
    });
    render(<InlinePermissionRequest request={request} onDecision={vi.fn()} />);
    expect(screen.getByText('30s')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter sudo password')).toBeInTheDocument();
  });

  it('stops countdown when Deny+Comment is clicked', () => {
    const onDecision = vi.fn();
    const request = makeRequest({ timeoutSec: 30 });

    // Set feedback in store
    usePermissionStore.setState((state) => ({
      ...state,
      feedbackDrafts: { 'req-exit-plan-1': 'my feedback' },
    }));

    render(<InlinePermissionRequest request={request} onDecision={onDecision} />);

    fireEvent.click(screen.getByText('Deny + Comment'));

    expect(onDecision).toHaveBeenCalledWith('req-exit-plan-1', false, false, undefined, 'my feedback');
    // After deny+comment, component should show resolved state
    expect(screen.getByText(/Denied/)).toBeInTheDocument();
  });

  it('does nothing for Deny+Comment when feedback is empty', () => {
    const onDecision = vi.fn();
    const request = makeRequest({ timeoutSec: 30 });
    render(<InlinePermissionRequest request={request} onDecision={onDecision} />);

    fireEvent.click(screen.getByText('Deny + Comment'));

    expect(onDecision).not.toHaveBeenCalled();
  });
});
