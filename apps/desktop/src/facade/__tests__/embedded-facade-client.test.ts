import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', MockWebSocket as any);
  });

  afterEach(() => {
    vi.useRealTimers();
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

  it('replays open backend and session stream state after reconnect', () => {
    const client = new EmbeddedFacadeClient(3100);
    client.connect();

    const firstWs = MockWebSocket.instances[0];
    firstWs.onopen?.();

    client.openBackend('backend-1');
    client.openSessionStream('backend-1', 'session-1');

    expect(firstWs.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'open_backend',
      backendId: 'backend-1',
    }));
    expect(firstWs.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'open_session_stream',
      backendId: 'backend-1',
      sessionId: 'session-1',
    }));

    firstWs.onclose?.();
    vi.runAllTimers();

    const secondWs = MockWebSocket.instances[1];
    expect(secondWs).toBeTruthy();

    secondWs.onopen?.();

    expect(secondWs.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'open_backend',
      backendId: 'backend-1',
    }));
    expect(secondWs.send).toHaveBeenCalledWith(JSON.stringify({
      type: 'open_session_stream',
      backendId: 'backend-1',
      sessionId: 'session-1',
    }));
  });

  it('emits reconnecting and connected connection state events across reconnects', () => {
    const client = new EmbeddedFacadeClient(3100);
    const events: string[] = [];
    client.onEvent((event) => {
      if (event.type === 'connection_state_changed') {
        events.push(event.state);
      }
    });

    client.connect();
    const firstWs = MockWebSocket.instances[0];
    firstWs.onopen?.();
    firstWs.onclose?.();
    vi.runAllTimers();

    const secondWs = MockWebSocket.instances[1];
    secondWs.onopen?.();

    expect(events).toEqual(['connected', 'reconnecting', 'connected']);
  });

  it('forceReconnect does not schedule a second reconnect from the old socket close', () => {
    const client = new EmbeddedFacadeClient(3100);
    client.connect();

    const firstWs = MockWebSocket.instances[0];
    firstWs.onopen?.();

    client.forceReconnect();

    expect(MockWebSocket.instances).toHaveLength(2);

    const secondWs = MockWebSocket.instances[1];
    secondWs.onopen?.();

    firstWs.onclose?.();
    vi.advanceTimersByTime(2500);

    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
