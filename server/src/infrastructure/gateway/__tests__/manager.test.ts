import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import { GatewayManager } from '../manager.js';

const { gatewayClientInstances } = vi.hoisted(() => ({
  gatewayClientInstances: [] as any[],
}));

vi.mock('../gateway-client.js', () => ({
  GatewayClient: class MockGatewayClient {
    public readonly commands = {
      connection: {
        connect: vi.fn(),
        disconnect: vi.fn(),
      },
      channel: {
        onIncomingMessage: vi.fn((listener: (channelId: string, message: unknown) => Promise<void>) => {
          this.onIncomingMessage = listener;
        }),
        onIncomingClosed: vi.fn((listener: (channelId: string) => void) => {
          this.onIncomingClosed = listener;
        }),
        onCatchUp: vi.fn((listener: (sessionId: string, afterOffset: number) => Promise<unknown[]>) => {
          this.onCatchUp = listener;
        }),
        sendToIncoming: vi.fn(),
      },
    };

    public readonly queries = {
      identity: {
        getInstanceId: vi.fn(() => 'instance-1'),
        getDeviceId: vi.fn(() => 'device-1'),
        getBackendId: vi.fn(() => null),
      },
      connection: {
        isConnected: vi.fn(() => false),
      },
      registry: {
        getDiscoveredBackends: vi.fn(() => []),
      },
    };

    public readonly events = {
      setOutgoingEvents: vi.fn((events: { onConnectionStateChanged?: (connected: boolean) => void }) => {
        this.outgoingEvents = events;
      }),
    };

    public onIncomingMessage?: (channelId: string, message: unknown) => Promise<void>;
    public onIncomingClosed?: (channelId: string) => void;
    public onCatchUp?: (sessionId: string, afterOffset: number) => Promise<unknown[]>;
    public outgoingEvents?: { onConnectionStateChanged?: (connected: boolean) => void };

    constructor(..._args: unknown[]) {
      gatewayClientInstances.push(this);
    }
  },
}));

vi.mock('../gateway-instance.js', () => ({
  setGatewayClient: vi.fn(),
}));

vi.mock('../gateway-channel-cleanup.js', () => ({
  handleChannelClosed: vi.fn(),
}));

vi.mock('../embedded-provider.js', () => ({
  EmbeddedBackendFacadeProvider: vi.fn(class MockEmbeddedBackendFacadeProvider {
    connect = vi.fn();
    disconnect = vi.fn();
    getWsHub = vi.fn(() => ({}) as any);
  }),
}));

vi.mock('../standalone-provider.js', () => ({
  StandaloneBackendFacadeProvider: vi.fn(class MockStandaloneBackendFacadeProvider {
    connect = vi.fn();
    disconnect = vi.fn();
    getWsHub = vi.fn(() => ({}) as any);
  }),
}));

vi.mock('../../../storage/db.js', () => ({
  initDatabase: vi.fn(),
}));

vi.mock('../../../utils/run-state.js', () => ({
  hasForegroundActiveRunForSession: vi.fn(() => false),
}));

describe('GatewayManager', () => {
  beforeEach(() => {
    gatewayClientInstances.length = 0;
    vi.clearAllMocks();
  });

  function createManager() {
    const connectedClients = new Map<string, unknown>();
    const virtualClient = { id: 'vc-1' };
    const terminalManager = { detachClient: vi.fn() };
    const serverContext = {
      db: { prepare: vi.fn() },
      handleMessage: vi.fn(),
      getStateHeartbeat: vi.fn(() => ({ type: 'state_heartbeat', activeRuns: [], pendingPermissions: [], pendingQuestions: [] })),
      setFacadeHub: vi.fn(),
      updateGatewayIdentity: vi.fn(),
      updateGatewayConnected: vi.fn(),
      updateGatewayBackendId: vi.fn(),
      updateDiscoveredBackends: vi.fn(),
      terminalManager,
    } as any;

    const manager = new GatewayManager({
      serverContext,
      activeRuns: new Map(),
      connectedClients: connectedClients as any,
      createVirtualClient: vi.fn(() => virtualClient as any),
      cancelRun: vi.fn(),
      host: '127.0.0.1',
    });

    manager.setPort(3100);

    return { manager, connectedClients, terminalManager, serverContext };
  }

  it('clears virtual clients when gateway disconnects unexpectedly', async () => {
    const { manager, connectedClients, terminalManager } = createManager();

    await manager.connect({
      id: 1,
      enabled: true,
      gatewayUrl: 'ws://gateway.example.com',
      gatewaySecret: 'secret',
      backendName: 'backend',
      gatewayBackendId: null,
      registerAsBackend: true,
      createdAt: 0,
      updatedAt: 0,
    });

    const client = gatewayClientInstances.at(-1)!;
    await client.onIncomingMessage?.('ch-1', { type: 'ping' });
    connectedClients.set('ch-1', { id: 'ws-1' });

    expect((manager as any).virtualClients.size).toBe(1);

    client.outgoingEvents?.onConnectionStateChanged?.(false);

    expect((manager as any).virtualClients.size).toBe(0);
    expect(connectedClients.has('ch-1')).toBe(false);
    expect(terminalManager.detachClient).toHaveBeenCalledWith('ch-1');
  });

  it('shutdown clears sync interval and virtual clients', () => {
    const { manager, connectedClients, terminalManager } = createManager();
    const disconnect = vi.fn();
    const fakeInterval = setInterval(() => {}, 1);
    clearInterval(fakeInterval);

    (manager as any).gatewayClient = { commands: { connection: { disconnect } } };
    (manager as any).syncInterval = fakeInterval;
    (manager as any).virtualClients.set('ch-1', { id: 'vc-1' });
    connectedClients.set('ch-1', { id: 'ws-1' });
    (manager as any).facadeProvider = { disconnect: vi.fn() };

    const clearIntervalSpy = vi.spyOn(global, 'clearInterval');

    manager.shutdown();

    expect(clearIntervalSpy).toHaveBeenCalledWith(fakeInterval);
    expect(disconnect).toHaveBeenCalled();
    expect((manager as any).virtualClients.size).toBe(0);
    expect(connectedClients.has('ch-1')).toBe(false);
    expect(terminalManager.detachClient).toHaveBeenCalledWith('ch-1');
  });

  it('local backend catch-up rethrows DB errors instead of returning empty patches', async () => {
    const { manager, serverContext } = createManager();
    serverContext.db.prepare = vi.fn().mockReturnValue({
      all: vi.fn(() => {
        throw new Error('db failed');
      }),
    });

    const localHandler = (manager as any).createLocalBackendHandler();

    await expect(localHandler.onCatchUp('session-1', 5)).rejects.toThrow('db failed');
  });

  it('does not reattach orphaned runs to an unrelated incoming channel', async () => {
    const { manager } = createManager();
    const orphanedClient = { id: 'old-channel', ws: { send: vi.fn() } };
    const run = {
      runId: 'run-1',
      sessionId: 'session-1',
      clientId: 'old-channel',
      client: orphanedClient,
      completed: false,
      broadcast: vi.fn(),
      pendingPermissions: new Map(),
      recentToolCalls: [],
      loopHeartbeatStreak: 0,
      eventSeq: 0,
      startedAt: Date.now(),
      lastActivityAt: Date.now(),
    };
    (manager as any).activeRuns.set('run-1', run);

    await manager.connect({
      id: 1,
      enabled: true,
      gatewayUrl: 'ws://gateway.example.com',
      gatewaySecret: 'secret',
      backendName: 'backend',
      gatewayBackendId: null,
      registerAsBackend: true,
      createdAt: 0,
      updatedAt: 0,
    });

    const client = gatewayClientInstances.at(-1)!;
    await client.onIncomingMessage?.('new-channel', { type: 'ping' });

    expect(run.clientId).toBe('old-channel');
    expect(run.client).toBe(orphanedClient);
  });
});
