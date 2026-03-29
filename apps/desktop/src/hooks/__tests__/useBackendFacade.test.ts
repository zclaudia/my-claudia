import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/messageHandler', () => ({
  handleServerMessage: vi.fn(),
}));

import { syncToGatewayStore } from '../useBackendFacade';
import { useFacadeStore } from '../../stores/facadeStore';
import { useToastStore } from '../../stores/toastStore';
import { handleServerMessage } from '../../services/messageHandler';
import { useServerStore } from '../../stores/serverStore';

describe('useBackendFacade run_event forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToastStore.setState({ toasts: [] });
    useServerStore.setState({
      activeServerId: null,
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'embedded-local',
      controlPlaneState: 'connecting',
    });
    useFacadeStore.setState({
      facade: null,
      mode: 'embedded',
      connectionState: 'connected',
      backends: [
        {
          backendId: 'local-standalone',
          name: 'Local',
          online: true,
          runtimeState: 'ready',
          openState: 'open',
          isThisInstance: true,
          instanceId: 'instance-local',
        } as any,
      ],
      sessionStreams: {},
      localBackendId: 'local-standalone',
      currentInstanceId: 'instance-local',
      currentDeviceId: 'device-local',
      registryRevision: 1,
      snapshotVersion: 1,
    });
  });

  it('forwards local backend run events to the shared message handler', () => {
    const serverEvent = {
      type: 'run_started',
      runId: 'run-1',
      sessionId: 'session-1',
      clientRequestId: 'client-1',
      userMessageId: 'user-1',
      assistantMessageId: 'assistant-1',
    } as any;

    syncToGatewayStore({
      type: 'run_event',
      backendId: 'local-standalone',
      event: serverEvent,
    } as any);

    expect(handleServerMessage).toHaveBeenCalledWith(
      serverEvent,
      expect.objectContaining({
        serverId: 'local-standalone',
        backendId: 'local-standalone',
        logTag: 'Facade:local-standalone',
      }),
    );
  });

  it('shows toast when content catch-up fails', () => {
    syncToGatewayStore({
      type: 'content_patch_failed',
      backendId: 'local-standalone',
      sessionId: 'session-1',
      afterOffset: 12,
      error: 'catch-up query failed',
    } as any);

    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: 'error',
      title: '消息同步失败',
      message: 'catch-up query failed',
    });
  });

  it('syncs backend capabilities into server features on snapshot updates', () => {
    syncToGatewayStore({
      type: 'snapshot_updated',
      snapshot: {
        snapshotVersion: 2,
        capturedAt: Date.now(),
        mode: 'embedded',
        connectionState: 'connected',
        localBackendId: 'local-standalone',
        currentInstanceId: 'instance-local',
        currentDeviceId: 'device-local',
        registryRevision: 2,
        sessionStreams: {},
        backends: [
          {
            backendId: 'local-standalone',
            name: 'Local',
            online: true,
            runtimeState: 'ready',
            openState: 'open',
            channelId: 'ch-1',
            instanceId: 'instance-local',
            deviceId: 'device-local',
            channel: 'local',
            isThisInstance: true,
            isThisDevice: true,
            capabilities: ['remoteTerminal'],
          },
        ],
      },
    } as any);

    expect(useServerStore.getState().connections['local-standalone']).toMatchObject({
      status: 'connected',
      features: ['remoteTerminal'],
    });
    expect(useServerStore.getState().activeServerSupports('remoteTerminal')).toBe(true);
  });
});
