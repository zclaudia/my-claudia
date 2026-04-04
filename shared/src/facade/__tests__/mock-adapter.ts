/**
 * MockFacadeGatewayAdapter for testing BackendFacadeRuntimeCore.
 */

import type { BackendPresence } from '../../protocol/gateway.js';
import type {
  FacadeAdapterBootstrapState,
  FacadeAdapterCommands,
  FacadeAdapterConnectionState,
  FacadeAdapterEvent,
  FacadeAdapterEventBus,
  FacadeAdapterQueries,
  FacadeRuntimeGatewayAdapter,
} from '../adapter.js';
import type { ClientMessage } from '../../protocol/messages.js';

export interface CommandLog {
  method: string;
  args: unknown[];
}

export function createMockAdapter(options?: {
  instanceId?: string;
  deviceId?: string;
  initialState?: FacadeAdapterConnectionState;
  registryItems?: BackendPresence[];
  subscribedBackendIds?: string[];
}): {
  adapter: FacadeRuntimeGatewayAdapter;
  emit: (event: FacadeAdapterEvent) => void;
  commandLog: CommandLog[];
  registry: Map<string, BackendPresence>;
} {
  const instanceId = options?.instanceId ?? 'inst-1';
  const deviceId = options?.deviceId ?? 'dev-1';
  const initialState = options?.initialState ?? 'connected';
  const registryItems = options?.registryItems ?? [];
  const subscribedBackendIds = options?.subscribedBackendIds ?? [];

  const commandLog: CommandLog[] = [];
  const listeners: Array<(event: FacadeAdapterEvent) => void> = [];
  const registry = new Map<string, BackendPresence>();
  const subscribedSet = new Set<string>(subscribedBackendIds);

  for (const item of registryItems) registry.set(item.backendId, item);

  function log(method: string, ...args: unknown[]) {
    commandLog.push({ method, args });
  }

  const commands: FacadeAdapterCommands = {
    connection: {
      connect: () => log('connection.connect'),
      disconnect: () => log('connection.disconnect'),
    },
    backend: {
      subscribe: (backendId) => log('backend.subscribe', backendId),
      unsubscribe: (backendId) => log('backend.unsubscribe', backendId),
      sendToBackend: (backendId, message) => log('backend.sendToBackend', backendId, message),
    },
    stream: {
      catchUp: (backendId, sessionId, afterOffset) => log('stream.catchUp', backendId, sessionId, afterOffset),
    },
  };

  const queries: FacadeAdapterQueries = {
    bootstrap: {
      getInitialState: (): FacadeAdapterBootstrapState => ({
        capturedAt: Date.now(),
        connection: { state: initialState },
        identity: { instanceId, deviceId },
        registry: { items: registryItems },
        subscriptions: { backendIds: subscribedBackendIds },
      }),
    },
    connection: {
      getState: () => initialState,
    },
    identity: {
      getInstanceId: () => instanceId,
      getDeviceId: () => deviceId,
    },
    registry: {
      getSnapshot: () => registry,
    },
    backend: {
      isSubscribed: (backendId) => subscribedSet.has(backendId),
    },
    http: {
      getBaseUrl: (backendId) => `http://mock/${backendId}`,
      getHeaders: () => ({ 'x-mock': 'true' }),
    },
  };

  const events: FacadeAdapterEventBus = {
    subscribe: (listener) => {
      listeners.push(listener);
      return () => {
        const idx = listeners.indexOf(listener);
        if (idx >= 0) listeners.splice(idx, 1);
      };
    },
  };

  function emit(event: FacadeAdapterEvent) {
    for (const l of listeners) l(event);
  }

  return {
    adapter: { commands, queries, events },
    emit,
    commandLog,
    registry,
  };
}

export function makePresence(overrides: Partial<BackendPresence> & { backendId: string }): BackendPresence {
  return {
    instanceId: 'inst-remote',
    deviceId: 'dev-remote',
    name: overrides.backendId,
    channel: 'default',
    visible: true,
    capabilities: [],
    epoch: 1,
    connectedAt: Date.now(),
    lastSeenAt: Date.now(),
    ...overrides,
  };
}
