import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectGatewayAdapter } from '../direct-adapter';

const { MockGatewayTransport, transportState } = vi.hoisted(() => {
  const transportState = {
    config: null as any,
  };

  class MockGatewayTransport {
    channels = new Map<string, { backendId: string; epoch: number }>();

    constructor(config: any) {
      transportState.config = config;
    }

    connect(): void {}
    disconnect(): void {}
    openChannel(): void {}
    closeChannel(): void {}
    sendToBackend(): void {}
    subscribeCatalog(): void {}
    unsubscribeCatalog(): void {}
    openSessionStream(): void {}
    closeSessionStream(): void {}
    catchUpContent(): void {}
    isConnected(): boolean { return true; }
    getRegistryRevision(): number { return 0; }
    getRegistryItems(): Map<string, never> { return new Map(); }
    getPeerSessionId(): string | null { return 'peer-1'; }
    getResolvedUrl(): string | null { return 'ws://gateway.example.com/ws'; }
  }

  return {
    MockGatewayTransport,
    transportState,
  };
});

vi.mock('../../hooks/transport/GatewayTransport', () => ({
  GatewayTransport: MockGatewayTransport,
}));

describe('DirectGatewayAdapter', () => {
  beforeEach(() => {
    transportState.config = null;
  });

  it('emits backend_channel_closed for tracked channels when the transport disconnects', () => {
    const adapter = new DirectGatewayAdapter({
      url: 'ws://gateway.example.com',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
    });

    const events: any[] = [];
    adapter.events.subscribe((event) => events.push(event));
    adapter.commands.connection.connect();

    transportState.config.onChannelOpened('backend-1', 'channel-1', 1, []);
    transportState.config.onDisconnected();

    expect(events).toContainEqual({
      type: 'backend_channel_closed',
      backendId: 'backend-1',
      channelId: 'channel-1',
      reason: 'transport_disconnected',
    });
    expect(events).toContainEqual({
      type: 'connection_state_changed',
      state: 'reconnecting',
    });
  });
});
