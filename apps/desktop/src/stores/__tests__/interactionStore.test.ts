import { beforeEach, describe, expect, it } from 'vitest';
import { useInteractionStore } from '../interactionStore';

describe('interactionStore', () => {
  beforeEach(() => {
    useInteractionStore.setState({ interactions: {} });
  });

  it('clears only client-synth plan reviews for the given session', () => {
    useInteractionStore.setState({
      interactions: {
        'client-plan': {
          type: 'interaction_plan_review',
          interactionId: 'client-plan',
          sessionId: 'session-1',
          source: 'client_synth',
          createdAt: 1,
          plan: 'Client plan',
        },
        'server-plan': {
          type: 'interaction_plan_review',
          interactionId: 'server-plan',
          sessionId: 'session-1',
          source: 'tool_call',
          createdAt: 1,
          plan: 'Server plan',
        },
        'other-client-plan': {
          type: 'interaction_plan_review',
          interactionId: 'other-client-plan',
          sessionId: 'session-2',
          source: 'client_synth',
          createdAt: 1,
          plan: 'Other client plan',
        },
        prompt: {
          type: 'interaction_prompt',
          interactionId: 'prompt',
          sessionId: 'session-1',
          source: 'provider_native',
          createdAt: 1,
          title: 'Question',
          fields: [],
        },
      },
    });

    useInteractionStore.getState().clearClientSynthPlanReviewsForSession('session-1');

    expect(useInteractionStore.getState().interactions).not.toHaveProperty('client-plan');
    expect(useInteractionStore.getState().interactions).toHaveProperty('server-plan');
    expect(useInteractionStore.getState().interactions).toHaveProperty('other-client-plan');
    expect(useInteractionStore.getState().interactions).toHaveProperty('prompt');
  });
});
