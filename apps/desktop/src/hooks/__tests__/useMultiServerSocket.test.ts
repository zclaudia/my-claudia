// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMultiServerSocket } from '../useMultiServerSocket.js';

// ---- Hoisted mocks ----

const {
  mockServerStoreState,
  mockUseServerStore,
  mockGatewayConnection,
  mockUseGatewayConnection,
  mockFacadeStoreState,
  mockUseFacadeStore,
  mockRecoveryStoreState,
  mockUseRecoveryStore,
  mockIsBackendReady,
} = vi.hoisted(() => {
  const serverState: Record<string, any> = {
    activeServerId: null,
  };
  const serverHook: any = vi.fn((selector?: any) => {
    if (selector) return selector(serverState);
    return serverState;
  });
  serverHook.getState = vi.fn(() => serverState);

  const gw = {
    openChannel: vi.fn(),
    sendToBackend: vi.fn(),
    isBackendConnected: vi.fn(() => false),
    isBackendAuthenticated: vi.fn(() => false),
    disconnectGateway: vi.fn(),
  };

  const facadeState: Record<string, any> = {
    facade: null,
    backends: [],
    connectionState: 'idle',
  };

  // Minimal zustand-like selector mock
  const facadeHook: any = vi.fn((selector?: any) => {
    if (selector) return selector(facadeState);
    return facadeState;
  });
  facadeHook.getState = vi.fn(() => facadeState);

  const recoveryState: Record<string, any> = {
    backends: {},
  };
  const recoveryHook: any = vi.fn((selector?: any) => {
    if (selector) return selector(recoveryState);
    return recoveryState;
  });
  recoveryHook.getState = vi.fn(() => recoveryState);

  return {
    mockServerStoreState: serverState,
    mockUseServerStore: serverHook,
    mockGatewayConnection: gw,
    mockUseGatewayConnection: vi.fn(() => gw),
    mockFacadeStoreState: facadeState,
    mockUseFacadeStore: facadeHook,
    mockRecoveryStoreState: recoveryState,
    mockUseRecoveryStore: recoveryHook,
    mockIsBackendReady: vi.fn(() => false),
  };
});

// ---- Module mocks ----

vi.mock('../useGatewayConnection', () => ({
  useGatewayConnection: mockUseGatewayConnection,
}));

vi.mock('../../stores/serverStore', () => ({
  useServerStore: mockUseServerStore,
}));

vi.mock('../../stores/facadeStore', () => ({
  useFacadeStore: mockUseFacadeStore,
}));

vi.mock('../../stores/recoveryStore', () => ({
  useRecoveryStore: mockUseRecoveryStore,
  isBackendReady: mockIsBackendReady,
}));

// ---- Tests ----

describe('hooks/useMultiServerSocket', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    mockServerStoreState.activeServerId = null;

    mockFacadeStoreState.facade = null;
    mockFacadeStoreState.backends = [];
    mockFacadeStoreState.connectionState = 'idle';
    mockRecoveryStoreState.backends = {};

    mockGatewayConnection.isBackendConnected.mockReturnValue(false);
    mockIsBackendReady.mockReturnValue(false);
  });

  describe('initialization', () => {
    it('initializes without active server', () => {
      const { result } = renderHook(() => useMultiServerSocket());
      expect(result.current).toBeDefined();
      expect(result.current.isConnected).toBe(false);
    });

    it('returns all expected API methods', () => {
      const { result } = renderHook(() => useMultiServerSocket());
      expect(typeof result.current.connectServer).toBe('function');
      expect(typeof result.current.disconnectServer).toBe('function');
      expect(typeof result.current.sendToServer).toBe('function');
      expect(typeof result.current.sendMessage).toBe('function');
      expect(typeof result.current.isServerConnected).toBe('function');
      expect(typeof result.current.getConnectedServers).toBe('function');
      expect(typeof result.current.connect).toBe('function');
      expect(typeof result.current.disconnect).toBe('function');
      expect(typeof result.current.isConnected).toBeDefined();
    });
  });

  describe('connectServer', () => {
    describe('with facade', () => {
      const mockFacade = {
        openBackend: vi.fn(),
        closeBackend: vi.fn(),
        sendToBackend: vi.fn(),
      };

      beforeEach(() => {
        mockFacadeStoreState.facade = mockFacade;
      });

      it('delegates to facade.openBackend', () => {
        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.connectServer('backend-1');
        });

        expect(mockFacade.openBackend).toHaveBeenCalledWith('backend-1');
      });

      it('does not call gateway openChannel when facade is present', () => {
        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.connectServer('backend-1');
        });

        expect(mockGatewayConnection.openChannel).not.toHaveBeenCalled();
      });
    });

    describe('without facade', () => {
      beforeEach(() => {
        mockFacadeStoreState.facade = null;
      });

      it('delegates to gatewayConnection.openChannel', () => {
        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.connectServer('backend-1');
        });

        expect(mockGatewayConnection.openChannel).toHaveBeenCalledWith('backend-1');
      });
    });
  });

  describe('disconnectServer', () => {
    describe('with facade', () => {
      const mockFacade = {
        openBackend: vi.fn(),
        closeBackend: vi.fn(),
        sendToBackend: vi.fn(),
      };

      beforeEach(() => {
        mockFacadeStoreState.facade = mockFacade;
      });

      it('delegates to facade.closeBackend', () => {
        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.disconnectServer('backend-1');
        });

        expect(mockFacade.closeBackend).toHaveBeenCalledWith('backend-1');
      });
    });

    describe('without facade', () => {
      it('is a no-op (does not throw)', () => {
        mockFacadeStoreState.facade = null;
        const { result } = renderHook(() => useMultiServerSocket());

        expect(() => {
          act(() => {
            result.current.disconnectServer('backend-1');
          });
        }).not.toThrow();
      });
    });
  });

  describe('sendToServer', () => {
    describe('with facade', () => {
      const mockFacade = {
        openBackend: vi.fn(),
        closeBackend: vi.fn(),
        sendToBackend: vi.fn(),
      };

      beforeEach(() => {
        mockFacadeStoreState.facade = mockFacade;
      });

      it('delegates to facade.sendToBackend', () => {
        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.sendToServer('backend-1', { type: 'ping' } as any);
        });

        expect(mockFacade.sendToBackend).toHaveBeenCalledWith('backend-1', { type: 'ping' });
      });

      it('does not call gateway sendToBackend when facade is present', () => {
        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.sendToServer('backend-1', { type: 'ping' } as any);
        });

        expect(mockGatewayConnection.sendToBackend).not.toHaveBeenCalled();
      });
    });

    describe('without facade', () => {
      beforeEach(() => {
        mockFacadeStoreState.facade = null;
      });

      it('delegates to gatewayConnection.sendToBackend', () => {
        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.sendToServer('backend-1', { type: 'ping' } as any);
        });

        expect(mockGatewayConnection.sendToBackend).toHaveBeenCalledWith('backend-1', { type: 'ping' });
      });
    });
  });

  describe('sendMessage (active server)', () => {
    it('logs error when no active server is set', () => {
      mockServerStoreState.activeServerId = null;

      const { result } = renderHook(() => useMultiServerSocket());

      act(() => {
        result.current.sendMessage({ type: 'ping' } as any);
      });

      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('no active server')
      );
    });

    it('sends to active server via facade when facade present', () => {
      const mockFacade = {
        openBackend: vi.fn(),
        closeBackend: vi.fn(),
        sendToBackend: vi.fn(),
      };
      mockFacadeStoreState.facade = mockFacade;
      mockServerStoreState.activeServerId = 'server-1';

      const { result } = renderHook(() => useMultiServerSocket());

      act(() => {
        result.current.sendMessage({ type: 'ping' } as any);
      });

      expect(mockFacade.sendToBackend).toHaveBeenCalledWith('server-1', { type: 'ping' });
    });

    it('sends to active server via gateway when no facade', () => {
      mockFacadeStoreState.facade = null;
      mockServerStoreState.activeServerId = 'server-1';

      const { result } = renderHook(() => useMultiServerSocket());

      act(() => {
        result.current.sendMessage({ type: 'ping' } as any);
      });

      expect(mockGatewayConnection.sendToBackend).toHaveBeenCalledWith('server-1', { type: 'ping' });
    });
  });

  describe('isServerConnected', () => {
    describe('with facade', () => {
      const mockFacade = {
        openBackend: vi.fn(),
        closeBackend: vi.fn(),
        sendToBackend: vi.fn(),
      };

      beforeEach(() => {
        mockFacadeStoreState.facade = mockFacade;
      });

      it('returns true when backend is found and isBackendReady returns true', () => {
        mockIsBackendReady.mockReturnValue(true);

        const { result } = renderHook(() => useMultiServerSocket());

        let connected = false;
        act(() => {
          connected = result.current.isServerConnected('backend-1');
        });

        expect(connected).toBe(true);
        expect(mockIsBackendReady).toHaveBeenCalledWith('backend-1');
      });

      it('returns false when backend is found but isBackendReady returns false', () => {
        const backend = { backendId: 'backend-1', online: false, runtimeState: 'offline' };
        mockFacadeStoreState.backends = [backend];
        mockIsBackendReady.mockReturnValue(false);

        const { result } = renderHook(() => useMultiServerSocket());

        let connected = true;
        act(() => {
          connected = result.current.isServerConnected('backend-1');
        });

        expect(connected).toBe(false);
      });

      it('returns false when backend is not found', () => {
        mockFacadeStoreState.backends = [];
        const { result } = renderHook(() => useMultiServerSocket());

        let connected = true;
        act(() => {
          connected = result.current.isServerConnected('nonexistent');
        });

        expect(connected).toBe(false);
      });
    });

    describe('without facade', () => {
      beforeEach(() => {
        mockFacadeStoreState.facade = null;
      });

      it('delegates to gatewayConnection.isBackendConnected', () => {
        mockGatewayConnection.isBackendConnected.mockReturnValue(true);

        const { result } = renderHook(() => useMultiServerSocket());

        let connected = false;
        act(() => {
          connected = result.current.isServerConnected('backend-1');
        });

        expect(connected).toBe(true);
        expect(mockGatewayConnection.isBackendConnected).toHaveBeenCalledWith('backend-1');
      });

      it('returns false when gateway reports not connected', () => {
        mockGatewayConnection.isBackendConnected.mockReturnValue(false);

        const { result } = renderHook(() => useMultiServerSocket());

        let connected = true;
        act(() => {
          connected = result.current.isServerConnected('backend-1');
        });

        expect(connected).toBe(false);
      });
    });
  });

  describe('isConnected (active server)', () => {
    it('returns false when no active server', () => {
      mockServerStoreState.activeServerId = null;

      const { result } = renderHook(() => useMultiServerSocket());

      expect(result.current.isConnected).toBe(false);
    });

    it('returns true when active server is connected via facade', () => {
      const mockFacade = {
        openBackend: vi.fn(),
        closeBackend: vi.fn(),
        sendToBackend: vi.fn(),
      };
      mockFacadeStoreState.facade = mockFacade;
      mockServerStoreState.activeServerId = 'server-1';
      mockIsBackendReady.mockReturnValue(true);

      const { result } = renderHook(() => useMultiServerSocket());

      expect(result.current.isConnected).toBe(true);
    });

    it('returns false when active server is not connected via facade', () => {
      const mockFacade = {
        openBackend: vi.fn(),
        closeBackend: vi.fn(),
        sendToBackend: vi.fn(),
      };
      mockFacadeStoreState.facade = mockFacade;
      mockServerStoreState.activeServerId = 'server-1';
      mockIsBackendReady.mockReturnValue(false);

      const { result } = renderHook(() => useMultiServerSocket());

      expect(result.current.isConnected).toBe(false);
    });

    it('returns true when active server is connected via gateway (no facade)', () => {
      mockFacadeStoreState.facade = null;
      mockServerStoreState.activeServerId = 'server-1';
      mockGatewayConnection.isBackendConnected.mockReturnValue(true);

      const { result } = renderHook(() => useMultiServerSocket());

      expect(result.current.isConnected).toBe(true);
    });

    it('returns false when active server is not connected via gateway (no facade)', () => {
      mockFacadeStoreState.facade = null;
      mockServerStoreState.activeServerId = 'server-1';
      mockGatewayConnection.isBackendConnected.mockReturnValue(false);

      const { result } = renderHook(() => useMultiServerSocket());

      expect(result.current.isConnected).toBe(false);
    });
  });

  describe('getConnectedServers', () => {
    describe('with facade', () => {
      const mockFacade = {
        openBackend: vi.fn(),
        closeBackend: vi.fn(),
        sendToBackend: vi.fn(),
      };

      beforeEach(() => {
        mockFacadeStoreState.facade = mockFacade;
      });

      it('returns empty array when no backends', () => {
        mockFacadeStoreState.backends = [];

        const { result } = renderHook(() => useMultiServerSocket());

        let servers: string[] = [];
        act(() => {
          servers = result.current.getConnectedServers();
        });

        expect(servers).toEqual([]);
      });

      it('returns only connected backend ids', () => {
        mockRecoveryStoreState.backends = {
          b1: { status: 'ready' },
          b2: { status: 'opening' },
        };

        const { result } = renderHook(() => useMultiServerSocket());

        let servers: string[] = [];
        act(() => {
          servers = result.current.getConnectedServers();
        });

        expect(servers).toEqual(['b1']);
      });

      it('returns all backend ids when all are connected', () => {
        mockRecoveryStoreState.backends = {
          b1: { status: 'ready' },
          b2: { status: 'ready' },
        };

        const { result } = renderHook(() => useMultiServerSocket());

        let servers: string[] = [];
        act(() => {
          servers = result.current.getConnectedServers();
        });

        expect(servers).toEqual(['b1', 'b2']);
      });
    });

    describe('without facade', () => {
      it('returns empty array', () => {
        mockFacadeStoreState.facade = null;

        const { result } = renderHook(() => useMultiServerSocket());

        let servers: string[] = [];
        act(() => {
          servers = result.current.getConnectedServers();
        });

        expect(servers).toEqual([]);
      });
    });
  });

  describe('connect/disconnect convenience methods', () => {
    describe('with facade', () => {
      const mockFacade = {
        openBackend: vi.fn(),
        closeBackend: vi.fn(),
        sendToBackend: vi.fn(),
      };

      beforeEach(() => {
        mockFacadeStoreState.facade = mockFacade;
      });

      it('connect() calls facade.openBackend with active server', () => {
        mockServerStoreState.activeServerId = 'server-1';

        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.connect();
        });

        expect(mockFacade.openBackend).toHaveBeenCalledWith('server-1');
      });

      it('disconnect() calls facade.closeBackend with active server', () => {
        mockServerStoreState.activeServerId = 'server-1';

        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.disconnect();
        });

        expect(mockFacade.closeBackend).toHaveBeenCalledWith('server-1');
      });

      it('connect() is a no-op when no active server', () => {
        mockServerStoreState.activeServerId = null;

        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.connect();
        });

        expect(mockFacade.openBackend).not.toHaveBeenCalled();
      });

      it('disconnect() is a no-op when no active server', () => {
        mockServerStoreState.activeServerId = null;

        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.disconnect();
        });

        expect(mockFacade.closeBackend).not.toHaveBeenCalled();
      });
    });

    describe('without facade', () => {
      beforeEach(() => {
        mockFacadeStoreState.facade = null;
      });

      it('connect() calls gateway openChannel with active server', () => {
        mockServerStoreState.activeServerId = 'server-1';

        const { result } = renderHook(() => useMultiServerSocket());

        act(() => {
          result.current.connect();
        });

        expect(mockGatewayConnection.openChannel).toHaveBeenCalledWith('server-1');
      });

      it('disconnect() is a no-op without facade', () => {
        mockServerStoreState.activeServerId = 'server-1';

        const { result } = renderHook(() => useMultiServerSocket());

        expect(() => {
          act(() => {
            result.current.disconnect();
          });
        }).not.toThrow();
      });
    });
  });
});
