import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAutomationBackendOptions } from '../useAutomationBackendOptions';
import { useFacadeStore } from '../../../stores/facadeStore';
import { useServerStore } from '../../../stores/serverStore';
import { useRecoveryStore } from '../../../stores/recoveryStore';
import { isAndroid } from '../../../utils/platform';

vi.mock('../../../utils/platform', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
  };
});

describe('useAutomationBackendOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isAndroid).mockReturnValue(false);

    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [
        { backendId: 'backend-1', name: 'Backend 1', runtimeState: 'ready', isThisInstance: false } as any,
      ],
    } as any);
    useServerStore.setState({
      connections: {
        'backend-1': { latencyMs: 42, isLocalConnection: false, features: [] },
      },
    } as any);
    useRecoveryStore.setState({
      backends: {
        'backend-1': { status: 'ready' },
      },
      getBackendViewState: (backendId: string) => (backendId === 'backend-1' ? 'ready' : 'offline'),
    } as any);
  });

  it('marks reachable backends from recovery store on desktop', () => {
    const { result } = renderHook(() => useAutomationBackendOptions());

    expect(result.current).toHaveLength(1);
    expect(result.current[0]?.isReachable).toBe(true);
    expect(result.current[0]?.status).toBe('ready');
  });

  it('marks backends as not reachable when not connected', () => {
    useFacadeStore.setState({
      connectionState: 'connecting',
      backends: [{ backendId: 'backend-1', runtimeState: 'visible', name: 'B1', online: true }],
    } as any);

    const { result } = renderHook(() => useAutomationBackendOptions());

    expect(result.current[0]?.isReachable).toBe(false);
    expect(result.current[0]?.status).toBe('transport_reconnecting');
  });
});
