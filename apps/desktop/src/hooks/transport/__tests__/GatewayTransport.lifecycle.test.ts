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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    ws.onclose?.();

    expect(onDisconnected).not.toHaveBeenCalled();
  });
});
