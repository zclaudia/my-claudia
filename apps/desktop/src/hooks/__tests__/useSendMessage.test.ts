import { describe, expect, it, vi } from 'vitest';
import { reconcileStaleLoadingRun } from '../chat/useSendMessage';

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
