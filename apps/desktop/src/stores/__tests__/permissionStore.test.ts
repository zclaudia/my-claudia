import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore, type PermissionRequest } from '../permissionStore';

describe('permissionStore', () => {
  beforeEach(() => {
    // Reset store state before each test (queue + compat field)
    usePermissionStore.setState({
      pendingRequests: [],
      pendingRequest: null,
    });
  });

  const createRequest = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
    requestId: 'req-1',
    toolName: 'Bash',
    detail: '{"command": "ls -la"}',
    timeoutSec: 60,
    ...overrides,
  });

  it('initial state has null pendingRequest', () => {
    expect(usePermissionStore.getState().pendingRequest).toBeNull();
  });

  it('setPendingRequest sets the pending request', () => {
    const request = createRequest();
    usePermissionStore.getState().setPendingRequest(request);

    expect(usePermissionStore.getState().pendingRequest).toEqual(request);
  });

  it('setPendingRequest enqueues multiple requests (pendingRequest is first in queue)', () => {
    const request1 = createRequest({ requestId: 'req-1' });
    const request2 = createRequest({ requestId: 'req-2', toolName: 'Write' });

    usePermissionStore.getState().setPendingRequest(request1);
    usePermissionStore.getState().setPendingRequest(request2);

    // pendingRequest is the first item in the FIFO queue
    expect(usePermissionStore.getState().pendingRequest).toEqual(request1);
    expect(usePermissionStore.getState().pendingRequests).toHaveLength(2);
    expect(usePermissionStore.getState().pendingRequests[1]).toEqual(request2);
  });

  it('clearRequest sets pendingRequest to null', () => {
    const request = createRequest();
    usePermissionStore.getState().setPendingRequest(request);
    usePermissionStore.getState().clearRequest();

    expect(usePermissionStore.getState().pendingRequest).toBeNull();
  });

  it('setPendingRequest(null) clears request', () => {
    const request = createRequest();
    usePermissionStore.getState().setPendingRequest(request);
    usePermissionStore.getState().setPendingRequest(null);

    expect(usePermissionStore.getState().pendingRequest).toBeNull();
  });
});
