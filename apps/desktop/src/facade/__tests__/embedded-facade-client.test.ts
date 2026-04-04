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

  it('suppresses server-relayed connection_state_changed events', () => {
    const client = new EmbeddedFacadeClient(3100);
    const events: any[] = [];
    client.onEvent((event) => events.push(event));

    client.connect();
    const ws = MockWebSocket.instances[0];
    ws.onopen?.();

    events.length = 0;

    // Server relays a gateway connection_state_changed through the WS
    ws.onmessage?.({
      data: JSON.stringify({ type: 'connection_state_changed', state: 'reconnecting' }),
    });

    // Should NOT be forwarded to event listeners
    expect(events.filter(e => e.type === 'connection_state_changed')).toHaveLength(0);

    // No snapshot received yet, so getSnapshot returns default (idle)
    expect(client.getSnapshot().connectionState).toBe('idle');

    // Set a known snapshot, then verify server events mutate latestSnapshot
    ws.onmessage?.({
      data: JSON.stringify({
        type: 'facade_snapshot',
        snapshot: {
          snapshotVersion: 1, capturedAt: 1, mode: 'embedded',
          connectionState: 'connected', localBackendId: null,
          currentInstanceId: null, currentDeviceId: null,
          backends: [], sessionStreams: {},
        },
      }),
    });

    ws.onmessage?.({
      data: JSON.stringify({ type: 'connection_state_changed', state: 'reconnecting' }),
    });

    expect(client.getSnapshot().connectionState).toBe('reconnecting');
    expect(events.filter(e => e.type === 'connection_state_changed')).toHaveLength(0);
  });

  it('still emits client-side connection_state_changed on ws open/close', () => {
    const client = new EmbeddedFacadeClient(3100);
    const states: string[] = [];
    client.onEvent((event) => {
      if (event.type === 'connection_state_changed') states.push(event.state);
    });

    client.connect();
    MockWebSocket.instances[0].onopen?.();
    expect(states).toEqual(['connected']);
  });

  it('forceReconnect does not schedule a second reconnect from the old socket close', () => {
    const client = new EmbeddedFacadeClient(3100);
    client.connect();

    const firstWs = MockWebSocket.instances[0];
    firstWs.onopen?.();

    // forceReconnect is a no-op when the socket is already open
    client.forceReconnect();
    expect(MockWebSocket.instances).toHaveLength(1);

    // Simulate the open socket closing unexpectedly
    firstWs.onclose?.();
    vi.advanceTimersByTime(2500);

    // A single reconnect should be scheduled (not duplicated)
    expect(MockWebSocket.instances).toHaveLength(2);
  });
});
