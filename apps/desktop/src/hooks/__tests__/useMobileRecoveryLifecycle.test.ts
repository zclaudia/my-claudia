import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const { startMock, stopMock } = vi.hoisted(() => ({
  startMock: vi.fn(),
  stopMock: vi.fn(),
}));

vi.mock('../../services/appLifecycleManager', () => ({
  appLifecycleManager: {
    start: startMock,
    stop: stopMock,
  },
}));

import { useRecoveryLifecycle } from '../useRecoveryLifecycle';

describe('useRecoveryLifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('registers lifecycle callbacks when facade is present', () => {
    const facade = {} as any;
    const manager = {
      start: vi.fn(),
      cancel: vi.fn(),
    } as any;

    renderHook(() => useRecoveryLifecycle(facade, manager));

    expect(startMock).toHaveBeenCalledOnce();
    const [, options] = startMock.mock.calls[0];

    options.onResume();
    options.onBackground();
    options.onNetworkOffline();

    expect(manager.start).toHaveBeenCalledWith('resume');
    expect(manager.cancel).toHaveBeenCalledTimes(2);
  });

  it('does nothing when facade is missing', () => {
    renderHook(() => useRecoveryLifecycle(null, {
      start: vi.fn(),
      cancel: vi.fn(),
    } as any));

    expect(startMock).not.toHaveBeenCalled();
  });

  it('stops the previous lifecycle before re-registering on rerender', () => {
    const facadeA = {} as any;
    const facadeB = {} as any;
    const manager = {
      start: vi.fn(),
      cancel: vi.fn(),
    } as any;

    const { rerender } = renderHook(
      ({ facade }) => useRecoveryLifecycle(facade, manager),
      {
        initialProps: {
          facade: facadeA as any,
        },
      },
    );

    expect(startMock).toHaveBeenCalledTimes(1);

    rerender({
      facade: facadeB as any,
    });

    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(startMock).toHaveBeenCalledTimes(2);
  });

  it('stops the lifecycle on unmount', () => {
    const { unmount } = renderHook(() => useRecoveryLifecycle({} as any, {
      start: vi.fn(),
      cancel: vi.fn(),
    } as any));

    unmount();

    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
