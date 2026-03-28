import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../services/messageHandler', () => ({
  handleServerMessage: vi.fn(),
}));

import { syncToGatewayStore } from '../useBackendFacade';
import { useFacadeStore } from '../../stores/facadeStore';
import { handleServerMessage } from '../../services/messageHandler';

describe('useBackendFacade run_event forwarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
});
