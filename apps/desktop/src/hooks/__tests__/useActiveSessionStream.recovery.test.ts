import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useActiveSessionStream } from '../useActiveSessionStream';
import { useFacadeStore } from '../../stores/facadeStore';
import { useProjectStore } from '../../stores/projectStore';
import { useServerStore } from '../../stores/serverStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useMobileRecoveryStore } from '../../stores/mobileRecoveryStore';

describe('useActiveSessionStream recovery gating', () => {
  const facade = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    getSnapshot: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    onEvent: vi.fn(() => () => {}),
    openBackend: vi.fn(),
    closeBackend: vi.fn(),
    sendToBackend: vi.fn(),
    openSessionStream: vi.fn(),
    closeSessionStream: vi.fn(),
    catchUpContent: vi.fn(),
    getHttpBaseUrl: vi.fn(() => null),
    getHttpHeaders: vi.fn(() => ({})),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useFacadeStore.setState({
      facade: facade as any,
      mode: 'direct',
      connectionState: 'connected',
      connectionError: null,
      backends: [{ backendId: 'backend-1', runtimeState: 'ready', openState: 'open', online: true, name: 'B1' } as any],
      sessionStreams: {},
      localBackendId: null,
      currentInstanceId: null,
      currentDeviceId: null,
      snapshotVersion: 1,
    });
    useProjectStore.setState({
      projects: [],
      sessions: [],
      providers: [],
      dataServerId: null,
      selectedProjectId: null,
      selectedSessionId: 'session-1',
      dashboardViews: {},
      providerCommands: {},
      providerCapabilities: {},
    } as any);
    useServerStore.setState({
      activeServerId: 'backend-1',
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'gateway-direct',
    } as any);
    useOwnershipStore.setState({
      sessionBackendIds: { 'session-1': 'backend-1' },
      sessionOwnershipVersions: { 'session-1': 1 },
      projectBackendIds: {},
      taskOwners: {},
    } as any);
    useMobileRecoveryStore.setState({
      phase: 'recovering',
      step: 'backend',
      activeBackendId: 'backend-1',
      selectedSessionId: 'session-1',
      currentJob: {
        jobId: 1,
        status: 'running',
        reason: 'resume',
        startedAt: Date.now(),
        finishedAt: null,
      },
      lastError: null,
    });
  });

  it('defers backend and stream maintenance while the recovery job owns the selected session', () => {
    renderHook(() => useActiveSessionStream());

    expect(facade.openBackend).not.toHaveBeenCalled();
    expect(facade.openSessionStream).not.toHaveBeenCalled();
    expect(facade.catchUpContent).not.toHaveBeenCalled();
  });

  it('resumes stream maintenance after recovery completes', () => {
    const { rerender } = renderHook(() => useActiveSessionStream());

    act(() => {
      useMobileRecoveryStore.setState({
        phase: 'ready',
        step: null,
        activeBackendId: 'backend-1',
        selectedSessionId: 'session-1',
        currentJob: {
          jobId: 1,
          status: 'completed',
          reason: 'resume',
          startedAt: Date.now(),
          finishedAt: Date.now(),
        },
        lastError: null,
      });
    });

    rerender();

    expect(facade.openSessionStream).toHaveBeenCalledWith('backend-1', 'session-1');
  });

  it('defers backend and stream maintenance while the mobile recovery job owns the selected session (session step)', () => {
    useMobileRecoveryStore.setState({
      phase: 'recovering',
      step: 'session',
      activeBackendId: 'backend-1',
      selectedSessionId: 'session-1',
      currentJob: {
        jobId: 1,
        status: 'running',
        reason: 'resume',
        startedAt: Date.now(),
        finishedAt: null,
      },
      lastError: null,
    });

    renderHook(() => useActiveSessionStream());

    expect(facade.openBackend).not.toHaveBeenCalled();
    expect(facade.openSessionStream).not.toHaveBeenCalled();
    expect(facade.catchUpContent).not.toHaveBeenCalled();
  });
});
