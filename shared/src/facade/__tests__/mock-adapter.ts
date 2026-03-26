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
  channels?: Array<{ backendId: string; channelId: string; epoch: number }>;
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
  const channelItems = options?.channels ?? [];

  const commandLog: CommandLog[] = [];
  const listeners: Array<(event: FacadeAdapterEvent) => void> = [];
  const registry = new Map<string, BackendPresence>();
  const channels = new Map<string, { backendId: string; channelId: string; epoch: number }>();

  for (const item of registryItems) registry.set(item.backendId, item);
  for (const ch of channelItems) channels.set(ch.backendId, ch);

  function log(method: string, ...args: unknown[]) {
    commandLog.push({ method, args });
  }

  const commands: FacadeAdapterCommands = {
    connection: {
      connect: () => log('connection.connect'),
      disconnect: () => log('connection.disconnect'),
    },
    channel: {
      openBackendChannel: (backendId, epoch) => log('channel.openBackendChannel', backendId, epoch),
      closeBackendChannel: (channelId) => log('channel.closeBackendChannel', channelId),
      sendToBackend: (channelId, message) => log('channel.sendToBackend', channelId, message),
    },
    catalog: {
      subscribe: (backendId, epoch, lastRevision?) => log('catalog.subscribe', backendId, epoch, lastRevision),
      unsubscribe: (backendId, epoch) => log('catalog.unsubscribe', backendId, epoch),
    },
    stream: {
      open: (channelId, sessionId) => log('stream.open', channelId, sessionId),
      close: (channelId, sessionId) => log('stream.close', channelId, sessionId),
      catchUp: (channelId, sessionId, afterOffset) => log('stream.catchUp', channelId, sessionId, afterOffset),
    },
  };

  const queries: FacadeAdapterQueries = {
    bootstrap: {
      getInitialState: (): FacadeAdapterBootstrapState => ({
        capturedAt: Date.now(),
        connection: { state: initialState },
        identity: { instanceId, deviceId },
        registry: { revision: 1, items: registryItems },
        channels: { items: channelItems },
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
      getRevision: () => 1,
      getSnapshot: () => registry,
    },
    channel: {
      get: (backendId) => channels.get(backendId),
      getAll: () => channels,
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
