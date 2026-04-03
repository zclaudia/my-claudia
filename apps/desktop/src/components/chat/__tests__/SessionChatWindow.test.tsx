import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { getCurrentWindow } from '@tauri-apps/api/window';

// Mock Tauri APIs with all required exports
const SERIALIZE_TO_IPC_FN = Symbol('SERIALIZE_TO_IPC_FN');

// Mock Resource class
class MockResource {
  rid: number;
  constructor(rid: number) { this.rid = rid; }
  [SERIALIZE_TO_IPC_FN]() { return { rid: this.rid }; }
}

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve()),
  SERIALIZE_TO_IPC_FN,
  transformCallback: vi.fn((cb: Function) => {
    if (cb) return 'mock-callback-id';
    return 'mock-callback-id';
  }),
  Resource: MockResource,
}));
vi.mock('@tauri-apps/plugin-shell', () => ({ Command: { create: vi.fn() } }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())),
  emitTo: vi.fn(),
  TauriEvent: {
    WINDOW_CLOSE_REQUESTED: 'tauri://close-requested',
  },
}));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    show: vi.fn(),
    setFocus: vi.fn(),
    close: mockWindowClose,
    onCloseRequested: vi.fn(() => Promise.resolve(vi.fn())),
  })),
}));

// Mock window.__TAURI_INTERNALS__ for dynamic imports
vi.stubGlobal('__TAURI_INTERNALS__', {
  metadata: {
    currentWindow: { label: 'main' },
    windows: {},
  },
});
vi.stubGlobal('__TAURI_EVENT_PLUGIN_INTERNALS__', {
  unregisterListener: vi.fn(),
});
vi.mock('@tauri-apps/api/dpi', () => ({
  PhysicalSize: class PhysicalSize {
    width = 0;
    height = 0;
    [SERIALIZE_TO_IPC_FN]() {
      return { width: this.width, height: this.height };
    }
  },
  PhysicalPosition: class PhysicalPosition {
    x = 0;
    y = 0;
    [SERIALIZE_TO_IPC_FN]() {
      return { x: this.x, y: this.y };
    }
  },
}));

// Mock ChatInterface (heavy child)
vi.mock('../ChatInterface', () => ({
  ChatInterface: ({ sessionId, onReturnToDashboard }: any) => (
    <div data-testid="chat-interface">
      ChatInterface: {sessionId}
      <button onClick={onReturnToDashboard}>Return</button>
    </div>
  ),
}));

// Mock ConnectionContext provider
vi.mock('../../../contexts/ConnectionContext', () => ({
  ConnectionProvider: ({ children, standaloneServerUrl, standaloneServerId, standaloneGatewayUrl, standaloneGatewaySecret }: any) => (
    <div
      data-testid="connection-provider"
      data-server-url={standaloneServerUrl}
      data-server-id={standaloneServerId}
      data-gateway-url={standaloneGatewayUrl}
      data-gateway-secret={standaloneGatewaySecret}
    >
      {children}
    </div>
  ),
  useConnection: () => ({
    serverUrl: 'http://localhost:3100',
    isConnected: true,
    activeBackend: 'local',
    setActiveBackend: vi.fn(),
  }),
}));

const mockGetProjects = vi.fn(() => Promise.resolve([]));
const mockGetSessions = vi.fn(() => Promise.resolve([]));
const mockGetProviders = vi.fn(() => Promise.resolve([]));
const mockWindowClose = vi.fn(() => Promise.resolve());

// Mock services
vi.mock('../../../services/api', () => ({
  getProjects: (...args: any[]) => mockGetProjects(...args),
  getSessions: (...args: any[]) => mockGetSessions(...args),
  getProviders: (...args: any[]) => mockGetProviders(...args),
}));

vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({
    selectProject: mockSelectProject,
    selectSession: mockSelectSession,
    selectSessionOnBackend: vi.fn(),
    selectBackend: vi.fn(),
  }),
}));

const mockSetProjects = vi.fn();
const mockMergeSessions = vi.fn();
const mockSetProviders = vi.fn();
const mockSelectProject = vi.fn();
const mockSelectSession = vi.fn();
const mockSetActiveServer = vi.fn();

let mockRecoveryStatus = 'disconnected';

// Mock stores
vi.mock('../../../stores/serverStore', () => ({
  useServerStore: Object.assign(
    (selector: any) => selector({
      activeServerId: 'backend-1',
      connections: {
        'backend-1': {
          isLocalConnection: false,
          features: [],
        },
      },
    } as any),
    {
      getState: () => ({
        setActiveServer: mockSetActiveServer,
      }),
    },
  ),
}));

vi.mock('../../../stores/recoveryStore', () => ({
  useRecoveryStore: (selector: any) => selector({
    backends: {
      'backend-1': {
        status: mockRecoveryStatus,
      },
    },
  } as any),
}));

vi.mock('../../../stores/projectStore', () => ({
  useProjectStore: Object.assign(
    (selector: any) => selector({
      projects: [],
      sessions: [],
      providers: [],
    } as any),
    {
      getState: () => ({
        setProjects: mockSetProjects,
        mergeSessions: mockMergeSessions,
        setProviders: mockSetProviders,
        selectProject: mockSelectProject,
        selectSession: mockSelectSession,
        setActiveServer: mockSetActiveServer,
      }),
    },
  ),
}));

import { SessionChatWindow } from '../SessionChatWindow';

describe('SessionChatWindow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRecoveryStatus = 'disconnected';
    mockGetProjects.mockResolvedValue([]);
    mockGetSessions.mockResolvedValue([]);
    mockGetProviders.mockResolvedValue([]);
    mockWindowClose.mockClear();
    mockSetActiveServer.mockClear();
    vi.mocked(getCurrentWindow).mockReturnValue({
      show: vi.fn(),
      setFocus: vi.fn(),
      close: mockWindowClose,
      onCloseRequested: vi.fn(() => Promise.resolve(vi.fn())),
    } as any);
  });

  it('renders without crashing', () => {
    const { container } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
        serverId="gw:backend-1"
      />
    );
    expect(container).toBeTruthy();
  });

  it('wraps content in a full-height container', () => {
    const { container } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
      />
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('h-dvh');
  });

  it('renders ConnectionProvider with standaloneServerUrl', () => {
    const { container } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
      />
    );
    const provider = container.querySelector('[data-testid="connection-provider"]');
    expect(provider).toBeTruthy();
    expect(provider?.getAttribute('data-server-url')).toBe('http://localhost:3100');
  });

  it('passes remote gateway context into ConnectionProvider', () => {
    const { container } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://127.0.0.1:43123/api/gateway-proxy/backend-1"
        authToken="test-token"
        serverId="gw:backend-1"
        serverName="Remote Backend"
        gatewayUrl="wss://gateway.example.com"
        gatewaySecret="secret-1"
      />
    );
    const provider = container.querySelector('[data-testid="connection-provider"]');
    expect(provider?.getAttribute('data-server-id')).toBe('gw:backend-1');
    expect(provider?.getAttribute('data-gateway-url')).toBe('wss://gateway.example.com');
    expect(provider?.getAttribute('data-gateway-secret')).toBe('secret-1');
  });

  it('shows loading spinner when not connected', () => {
    const { container } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
      />
    );
    const svg = container.querySelector('svg.animate-spin');
    expect(svg).toBeTruthy();
  });

  it('loads data and renders ChatInterface when connected', async () => {
    mockRecoveryStatus = 'ready';

    const { container } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
        serverId="gw:backend-1"
      />
    );

    await waitFor(() => {
      expect(container.querySelector('[data-testid="chat-interface"]')).toBeTruthy();
    });

    expect(mockGetProjects).toHaveBeenCalled();
    expect(mockGetSessions).toHaveBeenCalled();
    expect(mockGetProviders).toHaveBeenCalled();
    expect(mockSetProjects).toHaveBeenCalled();
    expect(mockMergeSessions).toHaveBeenCalled();
    expect(mockSetProviders).toHaveBeenCalled();
    expect(mockSelectProject).toHaveBeenCalledWith('proj-1');
    expect(mockSelectSession).toHaveBeenCalledWith('sess-1');
  });

  it('passes sessionId to ChatInterface', async () => {
    mockRecoveryStatus = 'ready';

    const { container } = render(
      <SessionChatWindow
        sessionId="sess-42"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain('ChatInterface: sess-42');
    });
  });

  it('shows error state when API calls fail', async () => {
    mockRecoveryStatus = 'ready';
    mockGetProjects.mockRejectedValueOnce(new Error('Server unreachable'));

    const { container } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain('Server unreachable');
    });
  });

  it('shows Close Window button on error', async () => {
    mockRecoveryStatus = 'ready';
    mockGetProjects.mockRejectedValueOnce(new Error('Failed'));

    const { container } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
      />
    );

    await waitFor(() => {
      expect(container.textContent).toContain('Close Window');
    });
  });

  it('uses tauri window close for error action', async () => {
    mockRecoveryStatus = 'ready';
    mockGetProjects.mockRejectedValueOnce(new Error('Failed'));

    const { findByText } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
      />
    );

    fireEvent.click(await findByText('Close Window'));

    await waitFor(() => {
      expect(mockWindowClose).toHaveBeenCalled();
    });
  });

  it('applies bg-background and text-foreground classes', () => {
    const { container } = render(
      <SessionChatWindow
        sessionId="sess-1"
        projectId="proj-1"
        serverUrl="http://localhost:3100"
        authToken="test-token"
      />
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('bg-background');
    expect(wrapper.className).toContain('text-foreground');
  });
});
