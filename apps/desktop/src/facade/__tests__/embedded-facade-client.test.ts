import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmbeddedFacadeClient } from '../embedded-facade-client';

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static OPEN = 1;

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  send = vi.fn();
  close = vi.fn();
}

describe('EmbeddedFacadeClient', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as any);
  });

  it('updates getSnapshot() when receiving snapshot_updated events', () => {
    const client = new EmbeddedFacadeClient(3100);
    client.connect();

    const ws = MockWebSocket.instances[0];
    expect(ws).toBeTruthy();

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'facade_snapshot',
        snapshot: {
          snapshotVersion: 1,
          capturedAt: 1,
          mode: 'embedded',
          connectionState: 'connected',
          localBackendId: 'local-standalone',
          currentInstanceId: 'instance-1',
          currentDeviceId: 'device-1',
          backends: [
            {
              backendId: 'local-standalone',
              name: 'Local',
              online: true,
              runtimeState: 'visible',
              openState: 'closed',
            },
          ],
          sessionStreams: {},
          registryRevision: 1,
        },
      }),
    });

    ws.onmessage?.({
      data: JSON.stringify({
        type: 'snapshot_updated',
        snapshot: {
          snapshotVersion: 2,
          capturedAt: 2,
          mode: 'embedded',
          connectionState: 'connected',
          localBackendId: 'local-standalone',
          currentInstanceId: 'instance-1',
          currentDeviceId: 'device-1',
          backends: [
            {
              backendId: 'local-standalone',
              name: 'Local',
              online: true,
              runtimeState: 'ready',
              openState: 'open',
            },
          ],
          sessionStreams: {},
          registryRevision: 1,
        },
      }),
    });

    expect(client.getSnapshot().snapshotVersion).toBe(2);
    expect(client.getSnapshot().backends[0]?.runtimeState).toBe('ready');
  });
});
