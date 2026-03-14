import '@testing-library/jest-dom';
import { vi } from 'vitest';

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
    setTimeout(() => {
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.(new CloseEvent('close'));
  });
}

vi.stubGlobal('WebSocket', MockWebSocket);

// Mock crypto.randomUUID with unique IDs
let uuidCounter = 0;
Object.defineProperty(globalThis, 'crypto', {
  value: {
    randomUUID: () => `test-uuid-${++uuidCounter}`,
  },
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

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query) => ({
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

// Mock IndexedDB for agentStorage tests
class MockIDBDatabase {
  name: string;
  version: number;
  objectStoreNames = { contains: vi.fn().mockReturnValue(false), length: 0 } as unknown as DOMStringList;

  constructor(name: string) {
    this.name = name;
    this.version = 1;
  }

  createObjectStore = vi.fn(() => ({
    createIndex: vi.fn(),
  }));
  transaction = vi.fn(() => {
    const tx: Record<string, unknown> = {
      oncomplete: null as ((ev: Event) => void) | null,
      onerror: null as ((ev: Event) => void) | null,
      commit: vi.fn(),
      abort: vi.fn(),
    };

    const makeRequest = (result?: unknown) => {
      const req: Record<string, unknown> = {
        result: result ?? undefined,
        error: null,
        onsuccess: null as ((ev: Event) => void) | null,
        onerror: null as ((ev: Event) => void) | null,
      };
      // Fire onsuccess then tx.oncomplete on next microtask
      Promise.resolve().then(() => {
        if (req.onsuccess) (req.onsuccess as (ev: Event) => void)(new Event('success'));
        if (tx.oncomplete) (tx.oncomplete as (ev: Event) => void)(new Event('complete'));
      });
      return req;
    };

    tx.objectStore = vi.fn(() => ({
      get: vi.fn(() => makeRequest(undefined)),
      put: vi.fn(() => makeRequest(undefined)),
      delete: vi.fn(() => makeRequest(undefined)),
      getAll: vi.fn(() => makeRequest([])),
      clear: vi.fn(() => makeRequest(undefined)),
    }));

    return tx;
  });
  close = vi.fn();
}

class MockIDBRequest<T = unknown> {
  result: T | null = null;
  error: DOMException | null = null;
  source: unknown = null;
  transaction: IDBTransaction | null = null;
  readyState: IDBRequestReadyState = 'pending';
  onsuccess: ((this: IDBRequest, ev: Event) => void) | null = null;
  onerror: ((this: IDBRequest, ev: Event) => void) | null = null;
}

class MockIDBOpenDBRequest extends MockIDBRequest<IDBDatabase> {
  onupgradeneeded: ((this: IDBOpenDBRequest, ev: IDBVersionChangeEvent) => void) | null = null;
  onblocked: ((this: IDBOpenDBRequest, ev: Event) => void) | null = null;
}

const mockIndexedDB = {
  open: vi.fn((name: string, version?: number) => {
    const request = new MockIDBOpenDBRequest();
    setTimeout(() => {
      request.result = new MockIDBDatabase(name) as unknown as IDBDatabase;
      request.onsuccess?.call(request as unknown as IDBOpenDBRequest, new Event('success'));
    }, 0);
    return request as unknown as IDBOpenDBRequest;
  }),
  deleteDatabase: vi.fn(),
  cmp: vi.fn((a: unknown, b: unknown) => (a === b ? 0 : a < b ? -1 : 1)),
};

vi.stubGlobal('indexedDB', mockIndexedDB);

// Mock fetch for API tests
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// Mock scrollIntoView for DOM elements
Element.prototype.scrollIntoView = vi.fn();

// Helper to reset mocks between tests
vi.stubGlobal('__resetDesktopMocks__', () => {
  mockFetch.mockReset();
  mockIndexedDB.open.mockClear();
});
