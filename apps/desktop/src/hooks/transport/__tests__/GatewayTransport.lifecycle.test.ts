import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GatewayTransport } from '../GatewayTransport';

class MockWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];

  readyState = MockWebSocket.OPEN;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(_url: string) {
    MockWebSocket.instances.push(this);
  }
}

describe('GatewayTransport lifecycle', () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
    vi.stubGlobal('WebSocket', MockWebSocket as any);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('does not trigger reconnect callbacks on intentional disconnect', () => {
    const onDisconnected = vi.fn();
    const transport = new GatewayTransport({
      url: 'ws://gateway.example.com/ws',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
      onConnected: vi.fn(),
      onDisconnected,
      onError: vi.fn(),
      onRegistryChanged: vi.fn(),
      onCatalogSnapshot: vi.fn(),
      onCatalogEvent: vi.fn(),
      onCatalogReset: vi.fn(),
      onChannelOpened: vi.fn(),
      onChannelRejected: vi.fn(),
      onChannelClosed: vi.fn(),
      onChannelMessage: vi.fn(),
      onRunStreamEvent: vi.fn(),
      onSessionStreamClosed: vi.fn(),
      onContentPatch: vi.fn(),
    });

    transport.connect();
    const ws = MockWebSocket.instances[0];
    transport.disconnect();
    ws.onclose?.({ code: 1000, reason: '', wasClean: true } as CloseEvent);

    expect(onDisconnected).not.toHaveBeenCalled();
  });

  it('reconnects after an unexpected close', () => {
    const transport = new GatewayTransport({
      url: 'ws://gateway.example.com/ws',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      onRegistryChanged: vi.fn(),
      onCatalogSnapshot: vi.fn(),
      onCatalogEvent: vi.fn(),
      onCatalogReset: vi.fn(),
      onChannelOpened: vi.fn(),
      onChannelRejected: vi.fn(),
      onChannelClosed: vi.fn(),
      onChannelMessage: vi.fn(),
      onRunStreamEvent: vi.fn(),
      onSessionStreamClosed: vi.fn(),
      onContentPatch: vi.fn(),
      onContentPatchError: vi.fn(),
    });

    transport.connect();
    const firstWs = MockWebSocket.instances[0];
    firstWs.onclose?.({ code: 1006, reason: 'network', wasClean: false } as CloseEvent);

    expect(MockWebSocket.instances).toHaveLength(1);

    vi.advanceTimersByTime(2000);

    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('forceReconnect replaces an authenticated socket immediately', () => {
    const transport = new GatewayTransport({
      url: 'ws://gateway.example.com/ws',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      onRegistryChanged: vi.fn(),
      onCatalogSnapshot: vi.fn(),
      onCatalogEvent: vi.fn(),
      onCatalogReset: vi.fn(),
      onChannelOpened: vi.fn(),
      onChannelRejected: vi.fn(),
      onChannelClosed: vi.fn(),
      onChannelMessage: vi.fn(),
      onRunStreamEvent: vi.fn(),
      onSessionStreamClosed: vi.fn(),
      onContentPatch: vi.fn(),
      onContentPatchError: vi.fn(),
    });

    transport.connect();
    const firstWs = MockWebSocket.instances[0];
    firstWs.readyState = MockWebSocket.OPEN;
    firstWs.onopen?.();
    (transport as any).authenticated = true;

    transport.forceReconnect();

    expect(firstWs.close).toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it('clears an in-flight health probe when the old socket closes', () => {
    const transport = new GatewayTransport({
      url: 'ws://gateway.example.com/ws',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onError: vi.fn(),
      onRegistryChanged: vi.fn(),
      onCatalogSnapshot: vi.fn(),
      onCatalogEvent: vi.fn(),
      onCatalogReset: vi.fn(),
      onChannelOpened: vi.fn(),
      onChannelRejected: vi.fn(),
      onChannelClosed: vi.fn(),
      onChannelMessage: vi.fn(),
      onRunStreamEvent: vi.fn(),
      onSessionStreamClosed: vi.fn(),
      onContentPatch: vi.fn(),
      onContentPatchError: vi.fn(),
    });

    transport.connect();
    const firstWs = MockWebSocket.instances[0];
    firstWs.readyState = MockWebSocket.OPEN;
    firstWs.onopen?.();
    (transport as any).authenticated = true;

    transport.probeHealth();
    firstWs.onclose?.({ code: 1006, reason: 'network', wasClean: false } as CloseEvent);

    vi.advanceTimersByTime(2000);

    const secondWs = MockWebSocket.instances[1];
    secondWs.readyState = MockWebSocket.OPEN;
    secondWs.onopen?.();
    (transport as any).authenticated = true;

    vi.advanceTimersByTime(10_000);

    expect(secondWs.close).not.toHaveBeenCalledWith(4000, 'health probe timeout');
  });
});
