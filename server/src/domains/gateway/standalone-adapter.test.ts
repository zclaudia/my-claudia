import { describe, expect, it, vi } from 'vitest';
import { StandaloneFacadeAdapter } from './standalone-adapter.js';
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

describe('StandaloneFacadeAdapter', () => {
  it('forwards local run events into facade adapter events', () => {
    const localHandler = createLocalHandler();
    const adapter = new StandaloneFacadeAdapter({
      serverPort: 3100,
      instanceId: 'standalone',
      deviceId: 'device-1',
      localHandler,
    });
    const events: any[] = [];
    adapter.events.subscribe((event) => events.push(event));

    adapter.commands.backend.subscribe('local-standalone');
    localHandler.emit({
      type: 'run_started',
      runId: 'run-1',
      sessionId: 'session-1',
      clientRequestId: 'client-1',
    });
    localHandler.emit({
      type: 'run_completed',
      runId: 'run-1',
      sessionId: 'session-1',
    });

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'run_event_received',
          backendId: 'local-standalone',
          sessionId: 'session-1',
          event: expect.objectContaining({ type: 'run_started', runId: 'run-1' }),
        }),
        expect.objectContaining({
          type: 'run_event_received',
          backendId: 'local-standalone',
          sessionId: 'session-1',
          event: expect.objectContaining({ type: 'run_completed', runId: 'run-1' }),
        }),
      ]),
    );
  });
});
