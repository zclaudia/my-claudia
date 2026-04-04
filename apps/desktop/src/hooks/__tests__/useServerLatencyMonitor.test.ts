import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useServerLatencyMonitor } from '../useServerLatencyMonitor';
import { useServerStore } from '../../stores/serverStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useFacadeStore } from '../../stores/facadeStore';
import { useMobileRecoveryStore } from '../../stores/mobileRecoveryStore';
import { probeServerLatency } from '../../services/api';
import { isAndroid } from '../../utils/platform';

vi.mock('../../services/api', () => ({
  probeServerLatency: vi.fn().mockResolvedValue(25),
}));

vi.mock('../../utils/platform', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
  };
});

describe('useServerLatencyMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.mocked(isAndroid).mockReturnValue(false);

    useServerStore.setState({
      connections: {},
      setServerLatency: vi.fn(),
    } as any);
    useRecoveryStore.setState({
      backends: {
        'backend-1': { status: 'ready' },
      },
    } as any);
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'backend-1', runtimeState: 'ready' } as any],
    } as any);
    useMobileRecoveryStore.getState().reset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('probes ready backends on desktop', async () => {
    renderHook(() => useServerLatencyMonitor());

    await act(async () => {
      await Promise.resolve();
    });

    expect(probeServerLatency).toHaveBeenCalledWith('backend-1');
  });

  it('skips latency probes on Android while mobile recovery is running', async () => {
    vi.mocked(isAndroid).mockReturnValue(true);
    useMobileRecoveryStore.setState({ phase: 'recovering' } as any);

    renderHook(() => useServerLatencyMonitor());

    await act(async () => {
      await Promise.resolve();
    });

    expect(probeServerLatency).not.toHaveBeenCalled();
  });
});
