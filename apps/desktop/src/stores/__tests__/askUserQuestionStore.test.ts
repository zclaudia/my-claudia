import { describe, it, expect, beforeEach } from 'vitest';
import { useAskUserQuestionStore, type AskUserQuestionRequest } from '../askUserQuestionStore';

describe('askUserQuestionStore', () => {
  beforeEach(() => {
    useAskUserQuestionStore.setState({ pendingRequests: [], pendingRequest: null });
  });

  const createRequest = (overrides: Partial<AskUserQuestionRequest> = {}): AskUserQuestionRequest => ({
    requestId: 'req-1',
    sessionId: 'session-1',
    questions: [
      {
        question: 'Choose an option',
        header: 'Selection',
        options: [
          { label: 'Option A', description: 'First option' },
          { label: 'Option B', description: 'Second option' },
        ],
      },
    ],
    ...overrides,
  });

  describe('initial state', () => {
    it('has null pendingRequest and empty queue', () => {
      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
      expect(useAskUserQuestionStore.getState().pendingRequests).toEqual([]);
    });
  });

  describe('setPendingRequest', () => {
    it('sets a pending request', () => {
      const request = createRequest();
      useAskUserQuestionStore.getState().setPendingRequest(request);

      expect(useAskUserQuestionStore.getState().pendingRequest).toEqual(request);
      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(1);
    });

    it('queues multiple requests (first stays as pendingRequest)', () => {
      const request1 = createRequest({ requestId: 'req-1' });
      const request2 = createRequest({ requestId: 'req-2' });

      useAskUserQuestionStore.getState().setPendingRequest(request1);
      useAskUserQuestionStore.getState().setPendingRequest(request2);

      expect(useAskUserQuestionStore.getState().pendingRequest?.requestId).toBe('req-1');
      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(2);
      expect(useAskUserQuestionStore.getState().pendingRequests[1].requestId).toBe('req-2');
    });

    it('does not add duplicate requestIds', () => {
      const request = createRequest({ requestId: 'req-1' });

      useAskUserQuestionStore.getState().setPendingRequest(request);
      useAskUserQuestionStore.getState().setPendingRequest(request);

      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(1);
    });

    it('clears request when called with null', () => {
      const request = createRequest();
      useAskUserQuestionStore.getState().setPendingRequest(request);
      useAskUserQuestionStore.getState().setPendingRequest(null);

      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
      expect(useAskUserQuestionStore.getState().pendingRequests).toEqual([]);
    });

    it('preserves full question structure', () => {
      const request = createRequest({
        questions: [
          {
            question: 'Multi-select question',
            header: 'Pick many',
            options: [
              { label: 'X', description: 'Option X' },
              { label: 'Y', description: 'Option Y' },
              { label: 'Z', description: 'Option Z' },
            ],
            multiSelect: true,
          },
        ],
      });

      useAskUserQuestionStore.getState().setPendingRequest(request);

      const stored = useAskUserQuestionStore.getState().pendingRequest;
      expect(stored?.questions).toHaveLength(1);
      expect(stored?.questions[0].multiSelect).toBe(true);
      expect(stored?.questions[0].options).toHaveLength(3);
    });

    it('stores serverId and backendName', () => {
      const request = createRequest({
        serverId: 'gw:backend-1',
        backendName: 'My Mac',
      });

      useAskUserQuestionStore.getState().setPendingRequest(request);

      const stored = useAskUserQuestionStore.getState().pendingRequest;
      expect(stored?.serverId).toBe('gw:backend-1');
      expect(stored?.backendName).toBe('My Mac');
    });
  });

  describe('clearRequest', () => {
    it('clears the first request and advances to next', () => {
      const request1 = createRequest({ requestId: 'req-1' });
      const request2 = createRequest({ requestId: 'req-2' });

      useAskUserQuestionStore.getState().setPendingRequest(request1);
      useAskUserQuestionStore.getState().setPendingRequest(request2);
      useAskUserQuestionStore.getState().clearRequest();

      expect(useAskUserQuestionStore.getState().pendingRequest?.requestId).toBe('req-2');
      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(1);
    });

    it('sets pendingRequest to null when queue is empty', () => {
      const request = createRequest();
      useAskUserQuestionStore.getState().setPendingRequest(request);
      useAskUserQuestionStore.getState().clearRequest();

      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
      expect(useAskUserQuestionStore.getState().pendingRequests).toEqual([]);
    });

    it('is safe to call when already null', () => {
      useAskUserQuestionStore.getState().clearRequest();

      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
    });
  });

  describe('clearAllRequests', () => {
    it('clears entire queue', () => {
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-1' }));
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-2' }));
      useAskUserQuestionStore.getState().clearAllRequests();

      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
      expect(useAskUserQuestionStore.getState().pendingRequests).toEqual([]);
    });
  });

  describe('clearRequestsForServer', () => {
    it('removes only requests from the specified server', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', serverId: 'gw:backend-2' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-3', serverId: 'gw:backend-1' })
      );

      useAskUserQuestionStore.getState().clearRequestsForServer('gw:backend-1');

      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(1);
      expect(useAskUserQuestionStore.getState().pendingRequest?.requestId).toBe('req-2');
    });

    it('clears everything when all requests are from the same server', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      useAskUserQuestionStore.getState().clearRequestsForServer('gw:backend-1');

      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
      expect(useAskUserQuestionStore.getState().pendingRequests).toEqual([]);
    });
  });

  describe('clearRequestById', () => {
    it('removes a specific request by ID', () => {
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-1' }));
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-2' }));
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-3' }));

      useAskUserQuestionStore.getState().clearRequestById('req-2');

      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(2);
      expect(useAskUserQuestionStore.getState().pendingRequests.map(r => r.requestId)).toEqual(['req-1', 'req-3']);
    });

    it('advances pendingRequest when the first item is removed', () => {
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-1' }));
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-2' }));

      useAskUserQuestionStore.getState().clearRequestById('req-1');

      expect(useAskUserQuestionStore.getState().pendingRequest?.requestId).toBe('req-2');
    });

    it('sets pendingRequest to null when last request is removed', () => {
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-1' }));

      useAskUserQuestionStore.getState().clearRequestById('req-1');

      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
      expect(useAskUserQuestionStore.getState().pendingRequests).toEqual([]);
    });

    it('is safe to call with non-existent ID', () => {
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-1' }));

      useAskUserQuestionStore.getState().clearRequestById('non-existent');

      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(1);
    });
  });

  describe('clearStaleRequests', () => {
    it('removes requests for a server not in the valid set', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', serverId: 'gw:backend-1' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-3', serverId: 'gw:backend-1' })
      );

      useAskUserQuestionStore.getState().clearStaleRequests('gw:backend-1', new Set(['req-2']));

      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(1);
      expect(useAskUserQuestionStore.getState().pendingRequest?.requestId).toBe('req-2');
    });

    it('does not affect requests from other servers', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', serverId: 'gw:backend-2' })
      );

      useAskUserQuestionStore.getState().clearStaleRequests('gw:backend-1', new Set());

      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(1);
      expect(useAskUserQuestionStore.getState().pendingRequest?.requestId).toBe('req-2');
    });

    it('keeps all requests when all are valid', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', serverId: 'gw:backend-1' })
      );

      useAskUserQuestionStore.getState().clearStaleRequests(
        'gw:backend-1',
        new Set(['req-1', 'req-2'])
      );

      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(2);
    });

    it('removes all requests when valid set is empty', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', serverId: 'gw:backend-1' })
      );

      useAskUserQuestionStore.getState().clearStaleRequests('gw:backend-1', new Set());

      expect(useAskUserQuestionStore.getState().pendingRequests).toEqual([]);
      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
    });
  });

  describe('hasRequest', () => {
    it('returns true for existing request', () => {
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-1' }));

      expect(useAskUserQuestionStore.getState().hasRequest('req-1')).toBe(true);
    });

    it('returns false for non-existent request', () => {
      expect(useAskUserQuestionStore.getState().hasRequest('non-existent')).toBe(false);
    });

    it('returns false after request is cleared', () => {
      useAskUserQuestionStore.getState().setPendingRequest(createRequest({ requestId: 'req-1' }));
      useAskUserQuestionStore.getState().clearRequestById('req-1');

      expect(useAskUserQuestionStore.getState().hasRequest('req-1')).toBe(false);
    });
  });

  describe('clearRequestsForSession', () => {
    it('removes requests for the specified session', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', sessionId: 'session-1' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', sessionId: 'session-2' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-3', sessionId: 'session-1' })
      );

      useAskUserQuestionStore.getState().clearRequestsForSession('session-1');

      expect(useAskUserQuestionStore.getState().pendingRequests).toHaveLength(1);
      expect(useAskUserQuestionStore.getState().pendingRequest?.requestId).toBe('req-2');
    });

    it('sets pendingRequest to null when all requests cleared', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', sessionId: 'session-1' })
      );
      useAskUserQuestionStore.getState().clearRequestsForSession('session-1');
      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
    });
  });

  describe('getRequestsForSession', () => {
    it('returns requests for the specified session', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', sessionId: 'session-1' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', sessionId: 'session-2' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-3', sessionId: 'session-1' })
      );

      const result = useAskUserQuestionStore.getState().getRequestsForSession('session-1');
      expect(result).toHaveLength(2);
      expect(result.map(r => r.requestId)).toEqual(['req-1', 'req-3']);
    });

    it('returns empty array when no requests for session', () => {
      expect(useAskUserQuestionStore.getState().getRequestsForSession('session-x')).toEqual([]);
    });
  });

  describe('getSessionsWithPendingRequests', () => {
    it('returns unique session IDs', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', sessionId: 'session-1' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', sessionId: 'session-2' })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-3', sessionId: 'session-1' })
      );

      const sessions = useAskUserQuestionStore.getState().getSessionsWithPendingRequests();
      expect(sessions).toHaveLength(2);
      expect(sessions).toContain('session-1');
      expect(sessions).toContain('session-2');
    });

    it('filters out requests without sessionId', () => {
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-1', sessionId: undefined })
      );
      useAskUserQuestionStore.getState().setPendingRequest(
        createRequest({ requestId: 'req-2', sessionId: 'session-1' })
      );

      const sessions = useAskUserQuestionStore.getState().getSessionsWithPendingRequests();
      expect(sessions).toEqual(['session-1']);
    });

    it('returns empty array when no requests', () => {
      expect(useAskUserQuestionStore.getState().getSessionsWithPendingRequests()).toEqual([]);
    });
  });
});
