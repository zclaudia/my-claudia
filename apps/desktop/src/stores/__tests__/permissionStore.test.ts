import { describe, it, expect, beforeEach } from 'vitest';
import { usePermissionStore, type PermissionRequest } from '../permissionStore';

describe('permissionStore', () => {
  beforeEach(() => {
    // Reset store state before each test (queue + compat field + feedback drafts)
    usePermissionStore.setState({
      pendingRequests: [],
      pendingRequest: null,
      feedbackDrafts: {},
    });
  });

  const createRequest = (overrides: Partial<PermissionRequest> = {}): PermissionRequest => ({
    requestId: 'req-1',
    sessionId: 'session-1',
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

  describe('clearRequestById', () => {
    it('removes a specific request by ID', () => {
      const req1 = createRequest({ requestId: 'req-1' });
      const req2 = createRequest({ requestId: 'req-2', toolName: 'Write' });
      const req3 = createRequest({ requestId: 'req-3', toolName: 'Read' });

      usePermissionStore.getState().setPendingRequest(req1);
      usePermissionStore.getState().setPendingRequest(req2);
      usePermissionStore.getState().setPendingRequest(req3);

      usePermissionStore.getState().clearRequestById('req-2');

      expect(usePermissionStore.getState().pendingRequests).toHaveLength(2);
      expect(usePermissionStore.getState().pendingRequests.map(r => r.requestId)).toEqual(['req-1', 'req-3']);
    });

    it('advances pendingRequest when the first item is removed', () => {
      const req1 = createRequest({ requestId: 'req-1' });
      const req2 = createRequest({ requestId: 'req-2' });

      usePermissionStore.getState().setPendingRequest(req1);
      usePermissionStore.getState().setPendingRequest(req2);

      usePermissionStore.getState().clearRequestById('req-1');

      expect(usePermissionStore.getState().pendingRequest?.requestId).toBe('req-2');
      expect(usePermissionStore.getState().pendingRequests).toHaveLength(1);
    });

    it('sets pendingRequest to null when last request is removed', () => {
      const req1 = createRequest({ requestId: 'req-1' });
      usePermissionStore.getState().setPendingRequest(req1);

      usePermissionStore.getState().clearRequestById('req-1');

      expect(usePermissionStore.getState().pendingRequest).toBeNull();
      expect(usePermissionStore.getState().pendingRequests).toEqual([]);
    });

    it('is safe to call with non-existent ID', () => {
      const req1 = createRequest({ requestId: 'req-1' });
      usePermissionStore.getState().setPendingRequest(req1);

      usePermissionStore.getState().clearRequestById('non-existent');

      expect(usePermissionStore.getState().pendingRequests).toHaveLength(1);
      expect(usePermissionStore.getState().pendingRequest?.requestId).toBe('req-1');
    });
  });

  describe('clearStaleRequests', () => {
    it('removes requests for a server that are not in the valid set', () => {
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', serverId: 'gw:backend-1' })
      );
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-3', serverId: 'gw:backend-1' })
      );

      // Only req-2 is still valid
      usePermissionStore.getState().clearStaleRequests('gw:backend-1', new Set(['req-2']));

      expect(usePermissionStore.getState().pendingRequests).toHaveLength(1);
      expect(usePermissionStore.getState().pendingRequest?.requestId).toBe('req-2');
    });

    it('does not affect requests from other servers', () => {
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', serverId: 'gw:backend-2' })
      );

      // Clear stale requests for backend-1 with no valid IDs
      usePermissionStore.getState().clearStaleRequests('gw:backend-1', new Set());

      expect(usePermissionStore.getState().pendingRequests).toHaveLength(1);
      expect(usePermissionStore.getState().pendingRequest?.requestId).toBe('req-2');
    });

    it('keeps all requests when all are valid', () => {
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', serverId: 'gw:backend-1' })
      );

      usePermissionStore.getState().clearStaleRequests(
        'gw:backend-1',
        new Set(['req-1', 'req-2'])
      );

      expect(usePermissionStore.getState().pendingRequests).toHaveLength(2);
    });

    it('removes all requests when valid set is empty', () => {
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', serverId: 'gw:backend-1' })
      );

      usePermissionStore.getState().clearStaleRequests('gw:backend-1', new Set());

      expect(usePermissionStore.getState().pendingRequests).toEqual([]);
      expect(usePermissionStore.getState().pendingRequest).toBeNull();
    });
  });

  describe('hasRequest', () => {
    it('returns true for existing request', () => {
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1' })
      );

      expect(usePermissionStore.getState().hasRequest('req-1')).toBe(true);
    });

    it('returns false for non-existent request', () => {
      expect(usePermissionStore.getState().hasRequest('non-existent')).toBe(false);
    });

    it('returns false after request is cleared', () => {
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1' })
      );
      usePermissionStore.getState().clearRequestById('req-1');

      expect(usePermissionStore.getState().hasRequest('req-1')).toBe(false);
    });
  });

  describe('feedbackDrafts', () => {
    it('initial state has empty feedbackDrafts', () => {
      expect(usePermissionStore.getState().feedbackDrafts).toEqual({});
    });

    it('setFeedbackDraft stores feedback for a request', () => {
      usePermissionStore.getState().setFeedbackDraft('req-1', 'This is my feedback');

      expect(usePermissionStore.getState().feedbackDrafts['req-1']).toBe('This is my feedback');
    });

    it('setFeedbackDraft updates existing feedback', () => {
      usePermissionStore.getState().setFeedbackDraft('req-1', 'First draft');
      usePermissionStore.getState().setFeedbackDraft('req-1', 'Updated draft');

      expect(usePermissionStore.getState().feedbackDrafts['req-1']).toBe('Updated draft');
    });

    it('setFeedbackDraft can store feedback for multiple requests', () => {
      usePermissionStore.getState().setFeedbackDraft('req-1', 'Feedback 1');
      usePermissionStore.getState().setFeedbackDraft('req-2', 'Feedback 2');

      expect(usePermissionStore.getState().feedbackDrafts).toEqual({
        'req-1': 'Feedback 1',
        'req-2': 'Feedback 2',
      });
    });

    it('clearFeedbackDraft removes feedback for a request', () => {
      usePermissionStore.getState().setFeedbackDraft('req-1', 'Some feedback');
      usePermissionStore.getState().clearFeedbackDraft('req-1');

      expect(usePermissionStore.getState().feedbackDrafts['req-1']).toBeUndefined();
    });

    it('clearFeedbackDraft is safe to call for non-existent request', () => {
      expect(() => {
        usePermissionStore.getState().clearFeedbackDraft('non-existent');
      }).not.toThrow();
    });

    it('clearRequest removes feedbackDraft for cleared request', () => {
      const req1 = createRequest({ requestId: 'req-1' });
      const req2 = createRequest({ requestId: 'req-2' });

      usePermissionStore.getState().setPendingRequest(req1);
      usePermissionStore.getState().setPendingRequest(req2);
      usePermissionStore.getState().setFeedbackDraft('req-1', 'Feedback for req-1');
      usePermissionStore.getState().setFeedbackDraft('req-2', 'Feedback for req-2');

      usePermissionStore.getState().clearRequest();

      expect(usePermissionStore.getState().feedbackDrafts['req-1']).toBeUndefined();
      expect(usePermissionStore.getState().feedbackDrafts['req-2']).toBe('Feedback for req-2');
    });

    it('clearRequestById removes feedbackDraft for that request', () => {
      const req1 = createRequest({ requestId: 'req-1' });
      const req2 = createRequest({ requestId: 'req-2' });

      usePermissionStore.getState().setPendingRequest(req1);
      usePermissionStore.getState().setPendingRequest(req2);
      usePermissionStore.getState().setFeedbackDraft('req-1', 'Feedback for req-1');
      usePermissionStore.getState().setFeedbackDraft('req-2', 'Feedback for req-2');

      usePermissionStore.getState().clearRequestById('req-1');

      expect(usePermissionStore.getState().feedbackDrafts['req-1']).toBeUndefined();
      expect(usePermissionStore.getState().feedbackDrafts['req-2']).toBe('Feedback for req-2');
    });

    it('clearAllRequests removes all feedbackDrafts', () => {
      usePermissionStore.getState().setFeedbackDraft('req-1', 'Feedback 1');
      usePermissionStore.getState().setFeedbackDraft('req-2', 'Feedback 2');

      usePermissionStore.getState().clearAllRequests();

      expect(usePermissionStore.getState().feedbackDrafts).toEqual({});
    });

    it('clearStaleRequests removes feedbackDrafts for stale requests', () => {
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      usePermissionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', serverId: 'gw:backend-1' })
      );
      usePermissionStore.getState().setFeedbackDraft('req-1', 'Feedback for req-1');
      usePermissionStore.getState().setFeedbackDraft('req-2', 'Feedback for req-2');

      // Only req-2 is still valid
      usePermissionStore.getState().clearStaleRequests('gw:backend-1', new Set(['req-2']));

      expect(usePermissionStore.getState().feedbackDrafts['req-1']).toBeUndefined();
      expect(usePermissionStore.getState().feedbackDrafts['req-2']).toBe('Feedback for req-2');
    });
  });
});
