import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DirectGatewayAdapter } from '../direct-adapter';

const { MockGatewayTransport, transportState } = vi.hoisted(() => {
  const transportState = {
    config: null as any,
    instance: null as any,
  };

  class MockGatewayTransport {
    subscribedBackends = new Set<string>();

    constructor(config: any) {
      transportState.config = config;
      transportState.instance = this;
    }

    connect(): void {}
    disconnect(): void {}
    forceReconnect(): void {}
    subscribe(backendId: string): void {
      this.subscribedBackends.add(backendId);
    }
    unsubscribe(backendId: string): void {
      this.subscribedBackends.delete(backendId);
    }
    sendToBackend(): void {}
    catchUpContent(): void {}
    isConnected(): boolean { return true; }
    isBackendSubscribed(backendId: string): boolean { return this.subscribedBackends.has(backendId); }
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
    transportState.instance = null;
  });

  it('emits backend_unsubscribed for tracked backends on forceReconnect', () => {
    const adapter = new DirectGatewayAdapter({
      url: 'ws://gateway.example.com',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
    });

    const events: any[] = [];
    adapter.events.subscribe((event) => events.push(event));
    adapter.commands.connection.connect();
    transportState.instance.subscribedBackends.add('backend-1');
    transportState.instance.subscribedBackends.add('backend-2');

    adapter.forceReconnect();

    const closures = events.filter((e: any) => e.type === 'backend_unsubscribed');
    expect(closures).toEqual([
      {
        type: 'backend_unsubscribed',
        backendId: 'backend-1',
        reason: 'transport_disconnected',
      },
      {
        type: 'backend_unsubscribed',
        backendId: 'backend-2',
        reason: 'transport_disconnected',
      },
    ]);
    expect(events).toContainEqual({
      type: 'connection_state_changed',
      state: 'reconnecting',
    });
  });

  it('emits backend_unsubscribed for tracked backends when the transport disconnects', () => {
    const adapter = new DirectGatewayAdapter({
      url: 'ws://gateway.example.com',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
    });

    const events: any[] = [];
    adapter.events.subscribe((event) => events.push(event));
    adapter.commands.connection.connect();
    transportState.instance.subscribedBackends.add('backend-1');

    transportState.config.onDisconnected();

    expect(events).toContainEqual({
      type: 'backend_unsubscribed',
      backendId: 'backend-1',
      reason: 'transport_disconnected',
    });
    expect(events).toContainEqual({
      type: 'connection_state_changed',
      state: 'reconnecting',
    });
  });

  it('forwards backend data events from transport', () => {
    const adapter = new DirectGatewayAdapter({
      url: 'ws://gateway.example.com',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
    });

    const events: any[] = [];
    adapter.events.subscribe((event) => events.push(event));
    adapter.commands.connection.connect();

    transportState.config.onBackendDataEvent('backend-1', {
      type: 'backend_data_event',
      op: 'project_upsert',
      item: {
        projectId: 'project-1',
        name: 'Project 1',
        createdAt: 1,
        updatedAt: 2,
      },
    });

    expect(events).toContainEqual({
      type: 'backend_data_event_received',
      backendId: 'backend-1',
      event: {
        type: 'backend_data_event',
        op: 'project_upsert',
        item: {
          projectId: 'project-1',
          name: 'Project 1',
          createdAt: 1,
          updatedAt: 2,
        },
      },
    });
  });
});
