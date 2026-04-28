import '@testing-library/jest-dom';
import { vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// ===== DOM API mocks =====

// Mock scrollTo
Element.prototype.scrollTo = vi.fn();
Element.prototype.scrollIntoView = vi.fn();

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock IntersectionObserver
global.IntersectionObserver = class IntersectionObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
};

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock WebSocket
class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSING = 2;
  readonly CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public url: string) {
    queueMicrotask(() => {
      this.onopen?.({ type: 'open' } as Event);
    });
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    const closeEvent = { type: 'close', wasClean: true, code: 1000, reason: '' } as CloseEvent;
    this.onclose?.(closeEvent);
  });
}

global.WebSocket = MockWebSocket as any;

// Mock crypto.randomUUID
let uuidCounter = 0;
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
  },
  configurable: true,
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] || null,
  };
})();

Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock navigator.clipboard
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'node.js',
    language: 'en-US',
    languages: ['en-US'],
    clipboard: {
      writeText: vi.fn(),
      readText: vi.fn(),
    },
  },
  configurable: true,
});

// Mock window.location
Object.defineProperty(window, 'location', {
  writable: true,
  value: {
    href: 'http://localhost:1420',
    pathname: '/',
    search: '',
    hash: '',
    reload: vi.fn(),
    replace: vi.fn(),
    assign: vi.fn(),
  },
});

// Mock Tauri internals
Object.defineProperty(window, '__TAURI_INTERNALS__', {
  writable: true,
  value: {
    transformCallback: vi.fn((cb: any) => cb),
  },
});

// ===== Tauri API Mocks =====

// Mock @tauri-apps/api
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
  convertFileSrc: vi.fn((path: string) => path),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
  TauriEvent: {},
}));

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: vi.fn(() => ({
    setTitle: vi.fn(),
    onCloseRequested: vi.fn(() => Promise.resolve(() => {})),
    onFocusChanged: vi.fn(() => Promise.resolve(() => {})),
    isFocused: vi.fn(() => Promise.resolve(true)),
  })),
  Window: {
    getByLabel: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/shell', () => ({
  Command: {
    create: vi.fn(() => ({
      execute: vi.fn(() => Promise.resolve({ code: 0, stdout: '', stderr: '' })),
    })),
    sidecar: vi.fn(() => ({
      execute: vi.fn(() => Promise.resolve({ code: 0, stdout: '', stderr: '' })),
      onClose: { listen: vi.fn() },
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      spawn: vi.fn(),
      kill: vi.fn(),
    })),
  },
  open: vi.fn(),
}));

vi.mock('@tauri-apps/api/fs', () => ({
  readDir: vi.fn(),
  readTextFile: vi.fn(),
  writeTextFile: vi.fn(),
  create: vi.fn(),
  mkdir: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  copyFile: vi.fn(),
  exists: vi.fn(),
  BaseDirectory: {
    Home: 1,
    AppData: 2,
    AppConfig: 3,
    AppCache: 4,
    AppLocalData: 5,
    AppLog: 6,
    Temp: 7,
    Document: 8,
    Download: 9,
    Desktop: 10,
    Executable: 11,
    Font: 12,
    Photo: 13,
    Video: 14,
    Audio: 15,
  },
}));

vi.mock('@tauri-apps/api/path', () => ({
  homeDir: vi.fn(() => Promise.resolve('/home/user')),
  appDataDir: vi.fn(() => Promise.resolve('/home/user/.my-claudia')),
  appConfigDir: vi.fn(() => Promise.resolve('/home/user/.config/my-claudia')),
  appCacheDir: vi.fn(() => Promise.resolve('/home/user/.cache/my-claudia')),
  appLocalDataDir: vi.fn(() => Promise.resolve('/home/user/.local/share/my-claudia')),
  appLogDir: vi.fn(() => Promise.resolve('/home/user/.local/state/my-claudia')),
  tempDir: vi.fn(() => Promise.resolve('/tmp')),
  desktopDir: vi.fn(() => Promise.resolve('/home/user/Desktop')),
  documentDir: vi.fn(() => Promise.resolve('/home/user/Documents')),
  downloadDir: vi.fn(() => Promise.resolve('/home/user/Downloads')),
  executableDir: vi.fn(() => Promise.resolve('/usr/bin')),
  join: vi.fn((...parts: string[]) => parts.join('/')),
  dirname: vi.fn((path: string) => path.split('/').slice(0, -1).join('/') || '/'),
  basename: vi.fn((path: string) => path.split('/').pop() || ''),
  extname: vi.fn((path: string) => {
    const base = path.split('/').pop() || '';
    const dot = base.lastIndexOf('.');
    return dot > 0 ? base.slice(dot) : '';
  }),
  sep: '/',
  delimiter: ':',
}));

vi.mock('@tauri-apps/api/notification', () => ({
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
  requestPermission: vi.fn(() => Promise.resolve('granted')),
  sendNotification: vi.fn(),
}));

vi.mock('@tauri-apps/plugin-os', () => ({
  platform: vi.fn(() => Promise.resolve('macos')),
  type: vi.fn(() => Promise.resolve('Darwin')),
  version: vi.fn(() => Promise.resolve('14.0')),
  arch: vi.fn(() => Promise.resolve('aarch64')),
  exeExtension: vi.fn(() => Promise.resolve('')),
}));

// Mock @tauri-apps/plugin-updater
vi.mock('@tauri-apps/plugin-updater', () => ({
  check: vi.fn(() => Promise.resolve(null)),
  onUpdaterEvent: vi.fn(() => Promise.resolve(() => {})),
}));

// ===== Hook Mocks =====

// Mock useMediaQuery hooks
vi.mock('@/hooks/useMediaQuery', () => ({
  useMediaQuery: vi.fn(() => false),
  useIsMobile: vi.fn(() => false),
  useIsTablet: vi.fn(() => false),
  useIsDesktop: vi.fn(() => true),
}));

// ===== Context Mocks =====

// Mock ThemeContext
vi.mock('@/contexts/ThemeContext', () => ({
  useTheme: vi.fn(() => ({
    theme: 'dark',
    resolvedTheme: 'dark',
    setTheme: vi.fn(),
    toggleTheme: vi.fn(),
  })),
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
  isDarkTheme: vi.fn(() => true),
}));

// Mock ConnectionContext
vi.mock('@/contexts/ConnectionContext', () => ({
  useConnection: vi.fn(() => ({
    isConnected: true,
    serverUrl: 'http://localhost:3100',
    socket: null,
    sendMessage: vi.fn(),
    connect: vi.fn(),
    disconnect: vi.fn(),
  })),
  ConnectionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// ===== Store Mocks =====

// Create mock store state
const createMockStore = (initialState: any) => {
  let state = { ...initialState };
  const listeners = new Set<(state: any) => void>();
  
  return {
    getState: () => state,
    setState: (updater: any) => {
      if (typeof updater === 'function') {
        state = updater(state);
      } else {
        state = { ...state, ...updater };
      }
      listeners.forEach(listener => listener(state));
    },
    subscribe: (listener: (state: any) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getInitialState: () => initialState,
  };
};

// Mock serverStore
const MOCK_LOCAL_BACKEND_ID = 'local-standalone';
const mockServerStore = createMockStore({
  servers: [{ id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: Date.now() }],
  activeServerId: MOCK_LOCAL_BACKEND_ID,
  connections: {
    [MOCK_LOCAL_BACKEND_ID]: {
      isLocalConnection: true,
      features: [],
    },
  },
  localServerPort: 3100,
  controlPlaneMode: 'embedded-local',
  setActiveServer: vi.fn(),
  setActiveServerId: vi.fn(),
  setServers: vi.fn(),
  setServerLocalConnection: vi.fn(),
  setServerFeatures: vi.fn(),
  setServerPublicKey: vi.fn(),
  setServerLatency: vi.fn(),
  setLocalServerPort: vi.fn(),
  setControlPlaneMode: vi.fn(),
  getActiveServer: vi.fn(() => ({ id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: Date.now() })),
  getServerConnection: vi.fn((serverId: string) => mockServerStore.getState().connections[serverId]),
  getActiveServerConnection: vi.fn(() => {
    const state = mockServerStore.getState();
    return state.activeServerId ? state.connections[state.activeServerId] : undefined;
  }),
  activeServerSupports: vi.fn((feature: string) => {
    const state = mockServerStore.getState();
    if (!state.activeServerId) return false;
    return state.connections[state.activeServerId]?.features?.includes(feature) ?? false;
  }),
});

const useServerStoreMock = vi.fn((selector?: (state: any) => any) => {
  const state = mockServerStore.getState();
  return selector ? selector(state) : state;
});
(useServerStoreMock as any).setState = mockServerStore.setState;
(useServerStoreMock as any).getState = mockServerStore.getState;
(useServerStoreMock as any).subscribe = mockServerStore.subscribe;

vi.mock('@/stores/serverStore', () => ({
  useServerStore: useServerStoreMock,
  serverStore: mockServerStore,
  ...mockServerStore,
}));

// Mock facadeStore
const mockFacadeStore = createMockStore({
  facade: null,
  mode: 'embedded',
  connectionState: 'connected',
  backends: [
    {
      backendId: MOCK_LOCAL_BACKEND_ID,
      name: 'Local',
      online: true,
      runtimeState: 'ready',
      isThisInstance: true,
      instanceId: 'instance-local',
    },
  ],
  sessionStreams: {},
  localBackendId: MOCK_LOCAL_BACKEND_ID,
  currentInstanceId: 'instance-local',
  currentDeviceId: 'device-local',
  snapshotVersion: 1,
  setFacade: vi.fn(),
  clearFacade: vi.fn(),
  applySnapshot: vi.fn(),
  applyEvent: vi.fn(),
});

const useFacadeStoreMock = vi.fn((selector?: (state: any) => any) => {
  const state = mockFacadeStore.getState();
  return selector ? selector(state) : state;
});
(useFacadeStoreMock as any).setState = mockFacadeStore.setState;
(useFacadeStoreMock as any).getState = mockFacadeStore.getState;
(useFacadeStoreMock as any).subscribe = mockFacadeStore.subscribe;

vi.mock('@/stores/facadeStore', () => ({
  useFacadeStore: useFacadeStoreMock,
  facadeStore: mockFacadeStore,
  ...mockFacadeStore,
}));

// Mock projectStore
const mockProjectStore = createMockStore({
  projects: [],
  activeProjectId: null,
  setActiveProjectId: vi.fn(),
  loadProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  deleteProject: vi.fn(),
  setProviderCommands: vi.fn(),
  providerCommands: [],
});

const useProjectStoreMock = vi.fn((selector?: (state: any) => any) => {
  const state = mockProjectStore.getState();
  return selector ? selector(state) : state;
});
(useProjectStoreMock as any).setState = mockProjectStore.setState;
(useProjectStoreMock as any).getState = mockProjectStore.getState;
(useProjectStoreMock as any).subscribe = mockProjectStore.subscribe;

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: useProjectStoreMock,
  projectStore: mockProjectStore,
  ...mockProjectStore,
}));

// Mock sessionsStore
const mockSessionsStore = createMockStore({
  sessions: [],
  loadSessions: vi.fn(),
  createSession: vi.fn(),
  updateSession: vi.fn(),
  deleteSession: vi.fn(),
  activeSessionId: null,
  setActiveSessionId: vi.fn(),
  recentlyCompleted: [],
  recentlyCompletedSessions: [],
  clearAllRecentlyCompleted: vi.fn(),
  dismissRecentlyCompleted: vi.fn(),
  activeSessionsByBackend: new Map(),
  setActiveSessionsForBackend: vi.fn((backendId: string, sessionIds: Set<string>) => {
    const state = mockSessionsStore.getState();
    const newMap = new Map(state.activeSessionsByBackend);
    newMap.set(backendId, sessionIds);
    mockSessionsStore.setState({ activeSessionsByBackend: newMap });
  }),
});

const useSessionsStoreMock = vi.fn((selector?: (state: any) => any) => {
  const state = mockSessionsStore.getState();
  return selector ? selector(state) : state;
});
(useSessionsStoreMock as any).setState = mockSessionsStore.setState;
(useSessionsStoreMock as any).getState = mockSessionsStore.getState;
(useSessionsStoreMock as any).subscribe = mockSessionsStore.subscribe;

// Mock uiStore
const mockUIStore = createMockStore({
  fontSize: 'medium',
  setFontSize: vi.fn(),
  advancedInput: false,
  setAdvancedInput: vi.fn(),
  forceScrollToBottomSessionId: null,
  requestForceScrollToBottom: vi.fn(),
  consumeForceScrollToBottom: vi.fn(),
  pendingMessageJump: null,
  requestMessageJump: vi.fn(),
  clearMessageJump: vi.fn(),
  poppedOutSessions: new Map(),
  addPoppedOutSession: vi.fn(),
  removePoppedOutSession: vi.fn(),
});

const useUIStoreMock = vi.fn((selector?: (state: any) => any) => {
  const state = mockUIStore.getState();
  return selector ? selector(state) : state;
});
(useUIStoreMock as any).setState = mockUIStore.setState;
(useUIStoreMock as any).getState = mockUIStore.getState;
(useUIStoreMock as any).subscribe = mockUIStore.subscribe;

vi.mock('@/stores/uiStore', () => ({
  useUIStore: useUIStoreMock,
  uiStore: mockUIStore,
  ...mockUIStore,
}));

// Mock gatewayStore
const mockGatewayStore = createMockStore({
  isConnected: false,
  showLocalBackend: false,
  directGatewayUrl: '',
  directGatewaySecret: '',
  discoveredBackends: [],
  localBackendId: null,
  gateways: [],
  activeGatewayId: null,
  setDirectGatewayConfig: vi.fn(),
  clearDirectGatewayConfig: vi.fn(),
  getDiscoveredBackends: vi.fn(() => []),
});

const useGatewayStoreMock = vi.fn((selector?: (state: any) => any) => {
  const state = mockGatewayStore.getState();
  return selector ? selector(state) : state;
});
(useGatewayStoreMock as any).setState = mockGatewayStore.setState;
(useGatewayStoreMock as any).getState = mockGatewayStore.getState;
(useGatewayStoreMock as any).subscribe = mockGatewayStore.subscribe;

vi.mock('@/stores/gatewayStore', () => ({
  useGatewayStore: useGatewayStoreMock,
  gatewayStore: mockGatewayStore,
  ...mockGatewayStore,
  toGatewayServerId: (backendId: string) => `gw:${backendId}`,
  parseBackendId: (serverId: string) => serverId.startsWith('gw:') ? serverId.slice(3) : serverId,
  isGatewayTarget: (serverId: string | null) => serverId?.startsWith('gw:') ?? false,
  shouldShowNonCurrentInstanceBackend: () => true,
  shouldShowBackend: () => true,
}));

// Mock sessionsStore constants
vi.mock('@/stores/sessionsStore', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useSessionsStore: useSessionsStoreMock,
    sessionsStore: mockSessionsStore,
    LOCAL_BACKEND_KEY: '__local__',
  };
});

// Mock permissionStore
const mockPermissionStore = createMockStore({
  pendingRequests: [],
  hasPendingRequests: false,
});

const usePermissionStoreMock = vi.fn((selector?: (state: any) => any) => {
  const state = mockPermissionStore.getState();
  return selector ? selector(state) : state;
});
(usePermissionStoreMock as any).setState = mockPermissionStore.setState;
(usePermissionStoreMock as any).getState = mockPermissionStore.getState;
(usePermissionStoreMock as any).subscribe = mockPermissionStore.subscribe;

vi.mock('@/stores/permissionStore', () => ({
  usePermissionStore: usePermissionStoreMock,
  permissionStore: mockPermissionStore,
  ...mockPermissionStore,
}));

// Mock promptRequestStore
const mockPromptRequestStore = createMockStore({
  pendingQuestions: [],
  hasPendingQuestions: false,
});

const usePromptRequestStoreMock = vi.fn((selector?: (state: any) => any) => {
  const state = mockPromptRequestStore.getState();
  return selector ? selector(state) : state;
});
(usePromptRequestStoreMock as any).setState = mockPromptRequestStore.setState;
(usePromptRequestStoreMock as any).getState = mockPromptRequestStore.getState;
(usePromptRequestStoreMock as any).subscribe = mockPromptRequestStore.subscribe;

vi.mock('@/stores/promptRequestStore', () => ({
  usePromptRequestStore: usePromptRequestStoreMock,
  promptRequestStore: mockPromptRequestStore,
  ...mockPromptRequestStore,
}));

// Mock fileViewerStore
const mockFileViewerStore = createMockStore({
  isOpen: false,
  filePath: null,
  fileContent: null,
  openFile: vi.fn(),
  close: vi.fn(),
});

const useFileViewerStoreMock = vi.fn((selector?: (state: any) => any) => {
  const state = mockFileViewerStore.getState();
  return selector ? selector(state) : state;
});
(useFileViewerStoreMock as any).setState = mockFileViewerStore.setState;
(useFileViewerStoreMock as any).getState = mockFileViewerStore.getState;
(useFileViewerStoreMock as any).subscribe = mockFileViewerStore.subscribe;

vi.mock('@/stores/fileViewerStore', () => ({
  useFileViewerStore: useFileViewerStoreMock,
  fileViewerStore: mockFileViewerStore,
  ...mockFileViewerStore,
}));

// ===== Clean up =====

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  uuidCounter = 0;
  localStorageMock.clear();
  
  // Reset stores to initial state
  mockServerStore.setState(mockServerStore.getInitialState());
  mockFacadeStore.setState(mockFacadeStore.getInitialState());
  mockProjectStore.setState(mockProjectStore.getInitialState());
  mockSessionsStore.setState(mockSessionsStore.getInitialState());
  mockUIStore.setState(mockUIStore.getInitialState());
  mockGatewayStore.setState(mockGatewayStore.getInitialState());
  mockPermissionStore.setState(mockPermissionStore.getInitialState());
  mockPromptRequestStore.setState(mockPromptRequestStore.getInitialState());
  mockFileViewerStore.setState(mockFileViewerStore.getInitialState());
});
