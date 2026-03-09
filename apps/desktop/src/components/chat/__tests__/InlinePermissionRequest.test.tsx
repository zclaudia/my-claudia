import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
    vi.clearAllMocks();
    usePermissionStore.setState((state) => ({
      ...state,
      pendingRequests: [],
      pendingRequest: null,
      feedbackDrafts: {},
    }));
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
});
