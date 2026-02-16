import { describe, it, expect, beforeEach } from 'vitest';
import { useAskUserQuestionStore, type AskUserQuestionRequest } from '../askUserQuestionStore';

describe('askUserQuestionStore', () => {
  beforeEach(() => {
    useAskUserQuestionStore.setState({ pendingRequest: null });
  });

  const createRequest = (overrides: Partial<AskUserQuestionRequest> = {}): AskUserQuestionRequest => ({
    requestId: 'req-1',
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
    it('has null pendingRequest', () => {
      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
    });
  });

  describe('setPendingRequest', () => {
    it('sets a pending request', () => {
      const request = createRequest();
      useAskUserQuestionStore.getState().setPendingRequest(request);

      expect(useAskUserQuestionStore.getState().pendingRequest).toEqual(request);
    });

    it('replaces existing pending request', () => {
      const request1 = createRequest({ requestId: 'req-1' });
      const request2 = createRequest({ requestId: 'req-2' });

      useAskUserQuestionStore.getState().setPendingRequest(request1);
      useAskUserQuestionStore.getState().setPendingRequest(request2);

      expect(useAskUserQuestionStore.getState().pendingRequest?.requestId).toBe('req-2');
    });

    it('clears request when called with null', () => {
      const request = createRequest();
      useAskUserQuestionStore.getState().setPendingRequest(request);
      useAskUserQuestionStore.getState().setPendingRequest(null);

      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
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
  });

  describe('clearRequest', () => {
    it('clears the pending request', () => {
      const request = createRequest();
      useAskUserQuestionStore.getState().setPendingRequest(request);
      useAskUserQuestionStore.getState().clearRequest();

      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
    });

    it('is safe to call when already null', () => {
      useAskUserQuestionStore.getState().clearRequest();

      expect(useAskUserQuestionStore.getState().pendingRequest).toBeNull();
    });
  });
});
