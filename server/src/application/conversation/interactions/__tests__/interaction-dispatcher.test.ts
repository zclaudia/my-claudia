import { beforeEach, describe, expect, it } from 'vitest';
import { interactionDispatcher } from '../interaction-dispatcher.js';

describe('interaction-dispatcher', () => {
  beforeEach(() => {
    interactionDispatcher.cancelBySession('session-1');
    interactionDispatcher.cancelBySession('session-2');
    interactionDispatcher.setSendFunction(() => {});
  });

  it('registers pending state before sending so synchronous responses are not lost', async () => {
    interactionDispatcher.setSendFunction((sessionId, event) => {
      expect(sessionId).toBe('session-1');
      expect(event.type).toBe('interaction_prompt');
      expect(
        interactionDispatcher.resolve('interaction-1', { approved: true }),
      ).toBe(true);
    });

    await expect(
      interactionDispatcher.dispatchAndWait(
        'interaction-1',
        'session-1',
        {
          type: 'interaction_prompt',
          interactionId: 'interaction-1',
          sessionId: 'session-1',
          source: 'tool_call',
          createdAt: Date.now(),
          title: 'Question',
          fields: [],
          submitLabel: 'Submit',
          responseMode: 'interaction_response',
          variant: 'form',
        },
        1000,
      ),
    ).resolves.toEqual({ approved: true });
  });

  it('cleans up pending state when send fails', async () => {
    interactionDispatcher.setSendFunction(() => {
      throw new Error('send failed');
    });

    await expect(
      interactionDispatcher.dispatchAndWait(
        'interaction-2',
        'session-2',
        {
          type: 'interaction_prompt',
          interactionId: 'interaction-2',
          sessionId: 'session-2',
          source: 'tool_call',
          createdAt: Date.now(),
          title: 'Question',
          fields: [],
          submitLabel: 'Submit',
          responseMode: 'interaction_response',
          variant: 'form',
        },
        1000,
      ),
    ).resolves.toEqual({ error: 'send failed' });

    expect(interactionDispatcher.pendingCount).toBe(0);
    expect(interactionDispatcher.hasPending('session-2')).toBe(false);
  });
});
