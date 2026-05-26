import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { reconcileStaleLoadingRun, useSendMessage } from '../chat/useSendMessage';
import { useInteractionStore } from '../../stores/interactionStore';

describe('reconcileStaleLoadingRun', () => {
  it('clears stale local run state when backend reports the session is idle', async () => {
    const clearLocalRun = vi.fn();
    const clearSessionActive = vi.fn();

    const recovered = await reconcileStaleLoadingRun({
      sessionId: 'session-1',
      sessionRunId: 'run-1',
      isLoading: true,
      getSessionRunState: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        isRunning: false,
      }),
      clearLocalRun,
      clearSessionActive,
    });

    expect(recovered).toBe(true);
    expect(clearLocalRun).toHaveBeenCalledWith('run-1');
    expect(clearSessionActive).toHaveBeenCalledWith('session-1');
  });

  it('does nothing when the backend still reports the session as running', async () => {
    const clearLocalRun = vi.fn();
    const clearSessionActive = vi.fn();

    const recovered = await reconcileStaleLoadingRun({
      sessionId: 'session-1',
      sessionRunId: 'run-1',
      isLoading: true,
      getSessionRunState: vi.fn().mockResolvedValue({
        sessionId: 'session-1',
        isRunning: true,
        activeRunId: 'run-2',
      }),
      clearLocalRun,
      clearSessionActive,
    });

    expect(recovered).toBe(false);
    expect(clearLocalRun).not.toHaveBeenCalled();
    expect(clearSessionActive).not.toHaveBeenCalled();
  });

  it('does nothing when there is no active local run to reconcile', async () => {
    const clearLocalRun = vi.fn();
    const clearSessionActive = vi.fn();
    const getSessionRunState = vi.fn();

    const recovered = await reconcileStaleLoadingRun({
      sessionId: 'session-1',
      sessionRunId: null,
      isLoading: true,
      getSessionRunState,
      clearLocalRun,
      clearSessionActive,
    });

    expect(recovered).toBe(false);
    expect(getSessionRunState).not.toHaveBeenCalled();
    expect(clearLocalRun).not.toHaveBeenCalled();
    expect(clearSessionActive).not.toHaveBeenCalled();
  });
});

describe('useSendMessage', () => {
  it('clears client-synth plan reviews after a normal message starts a run successfully', async () => {
    useInteractionStore.setState({
      interactions: {
        'plan-1': {
          type: 'interaction_plan_review',
          interactionId: 'plan-1',
          sessionId: 'session-1',
          source: 'client_synth',
          createdAt: 1,
          plan: 'Review this plan',
        },
      },
    });

    const wsSendMessage = vi.fn();
    const addMessage = vi.fn();
    const scrollToBottom = vi.fn();
    const { result } = renderHook(() => useSendMessage({
      sessionId: 'session-1',
      isConnected: true,
      isLoading: false,
      sessionRunId: null,
      isSessionRunning: false,
      lastSessionMessage: null,
      mode: 'default',
      modelOverride: '',
      permissionOverride: null,
      currentSession: undefined,
      addMessage,
      scrollToBottom,
      wsSendMessage,
    }));

    await act(async () => {
      await result.current.handleSendMessage('execute the plan');
    });

    expect(wsSendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run_start',
      sessionId: 'session-1',
    }));
    expect(useInteractionStore.getState().interactions).not.toHaveProperty('plan-1');
  });
});
