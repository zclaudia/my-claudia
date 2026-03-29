import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const disconnectMock = vi.fn();
const startMock = vi.fn();
const stopMock = vi.fn();
const collectGarbageMock = vi.fn();

vi.mock('../direct-adapter', () => ({
  DirectGatewayAdapter: class MockDirectGatewayAdapter {
    commands = {
      connection: {
        connect: connectMock,
        disconnect: disconnectMock,
      },
    };
    events = {
      subscribe: vi.fn(() => () => {}),
    };
    queries = {
      bootstrap: {
        getInitialState: vi.fn(() => ({
          capturedAt: Date.now(),
          connection: { state: 'idle' },
          identity: { instanceId: 'instance-1', deviceId: 'device-1' },
          registry: { revision: 0, items: [] },
          channels: { items: [] },
        })),
      },
      http: {
        getBaseUrl: vi.fn(() => null),
        getHeaders: vi.fn(() => ({})),
      },
    };
  },
}));

vi.mock('@my-claudia/shared', async () => {
  const actual = await vi.importActual<typeof import('@my-claudia/shared')>('@my-claudia/shared');
  return {
    ...actual,
    DEFAULT_GC_INTERVAL: 1000,
    BackendFacadeRuntimeCore: class MockRuntimeCore {
      start = startMock;
      stop = stopMock;
      collectGarbage = collectGarbageMock;
      getSnapshot = vi.fn(() => ({
        snapshotVersion: 0,
        capturedAt: Date.now(),
        mode: 'direct',
        connectionState: 'idle',
        localBackendId: null,
        currentInstanceId: null,
        currentDeviceId: null,
        backends: [],
        sessionStreams: {},
        registryRevision: 0,
      }));
      subscribe = vi.fn(() => () => {});
      onEvent = vi.fn(() => () => {});
      openBackend = vi.fn();
      closeBackend = vi.fn();
      sendToBackend = vi.fn();
      openSessionStream = vi.fn();
      closeSessionStream = vi.fn();
      catchUpContent = vi.fn();
      getHttpBaseUrl = vi.fn(() => null);
      getHttpHeaders = vi.fn(() => ({}));
    },
  };
});

import { DirectBackendFacadeProvider } from '../direct-provider';

describe('DirectBackendFacadeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('connects the adapter when the provider starts', () => {
    const provider = new DirectBackendFacadeProvider({
      url: 'wss://gateway.example.com',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
    });

    provider.connect();

    expect(startMock).toHaveBeenCalledTimes(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('disconnects the adapter when the provider stops', () => {
    const provider = new DirectBackendFacadeProvider({
      url: 'wss://gateway.example.com',
      gatewaySecret: 'secret',
      deviceId: 'device-1',
      instanceId: 'instance-1',
    });

    provider.disconnect();

    expect(disconnectMock).toHaveBeenCalledTimes(1);
    expect(stopMock).toHaveBeenCalledTimes(1);
  });
});
