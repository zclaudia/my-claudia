import { describe, expect, it, vi } from 'vitest';
import { EmbeddedGatewayAdapter } from './embedded-adapter.js';
import type { LocalBackendHandler } from './embedded-adapter.js';
import type { ServerMessage } from '@my-claudia/shared';

type TestLocalHandler = LocalBackendHandler & { emit(message: ServerMessage): void };

function createLocalHandler(): TestLocalHandler {
  const listeners = new Set<(message: ServerMessage) => void>();
  return {
    onMessage: vi.fn(),
    onStreamOpen: vi.fn(),
    onStreamClose: vi.fn(),
    onCatchUp: vi.fn(async () => []),
    onServerEvent: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSessionItems: vi.fn(() => []),
    getProjectItems: vi.fn(() => []),
    getCapabilities: vi.fn(() => []),
    emit(message: ServerMessage) {
      for (const listener of listeners) listener(message);
    },
  } as TestLocalHandler;
}

function createGatewayClientMock() {
  return {
    commands: {
      connection: { connect: vi.fn(), disconnect: vi.fn() },
      channel: { openOutgoing: vi.fn(), closeOutgoing: vi.fn(), sendToOutgoing: vi.fn() },
      catalog: { subscribeOutgoing: vi.fn(), unsubscribeOutgoing: vi.fn() },
      stream: { openOutgoing: vi.fn(), closeOutgoing: vi.fn(), catchUpOutgoing: vi.fn() },
    },
    queries: {
      connection: { isConnected: () => true },
      identity: { getInstanceId: () => 'instance-1', getDeviceId: () => 'device-1', getBackendId: () => 'backend-local', getEpoch: () => 1 },
      registry: { getItems: () => new Map() },
      channel: {
        getOutgoing: vi.fn(),
        getAllOutgoing: () => new Map(),
      },
    },
    events: {
      setOutgoingEvents: vi.fn(),
    },
  };
}

describe('EmbeddedGatewayAdapter', () => {
  it('forwards local run events into facade adapter events', () => {
    const localHandler = createLocalHandler();
    const gatewayClient = createGatewayClientMock();
    const adapter = new EmbeddedGatewayAdapter(gatewayClient as any, localHandler, 3100);
    adapter.setLocalBackendId('backend-local');
    const events: any[] = [];
    adapter.events.subscribe((event) => events.push(event));

    adapter.commands.backend.subscribe('backend-local');
    localHandler.emit({
      type: 'run_started',
      runId: 'run-1',
      sessionId: 'session-1',
      clientRequestId: 'client-1',
    });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'run_event_received',
          backendId: 'backend-local',
          sessionId: 'session-1',
          event: expect.objectContaining({ type: 'run_started', runId: 'run-1' }),
        }),
      ]),
    );
  });
});
