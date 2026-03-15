import '@testing-library/jest-dom';
import { vi } from 'vitest';

// 轻量级 setup 文件，用于纯逻辑测试（stores/utils/hooks）
// 使用 node 环境运行，但保留必要的浏览器 API mock

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
    // 在 node 环境中模拟 CloseEvent
    const closeEvent = { type: 'close', wasClean: true, code: 1000, reason: '' } as CloseEvent;
    this.onclose?.(closeEvent);
  });
}

vi.stubGlobal('WebSocket', MockWebSocket);

// Mock crypto.randomUUID with unique IDs
let uuidCounter = 0;
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
  },
  configurable: true,
});

// Mock localStorage for zustand persist
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

// Mock matchMedia
defineProperty(globalThis, 'matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
}));

// Mock fetch for API tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Helper to reset mocks between tests
vi.stubGlobal('__resetDesktopMocks__', () => {
  mockFetch.mockReset();
});

// Reset uuid counter between tests
vi.stubGlobal('__resetUuidCounter__', () => {
  uuidCounter = 0;
});

// 简化版的 defineProperty helper
function defineProperty(obj: any, prop: string, value: any) {
  try {
    Object.defineProperty(obj, prop, {
      value,
      configurable: true,
      writable: true,
    });
  } catch {
    // 忽略只读属性错误
  }
}
