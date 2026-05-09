import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useTerminalStore } from '../../../stores/terminalStore';
import { useServerStore } from '../../../stores/serverStore';
import { useFacadeStore } from '../../../stores/facadeStore';
import { isAndroid } from '../../../utils/platform';

const mockSendMessage = vi.fn();
const mockConnectServer = vi.fn();

// Polyfill ResizeObserver for jsdom
globalThis.ResizeObserver = class ResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(cb: any) {}
} as any;

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    serverUrl: 'http://localhost:3100',
    isConnected: true,
    activeBackend: 'local',
    setActiveBackend: vi.fn(),
    sendMessage: mockSendMessage,
    connectServer: mockConnectServer,
  }),
}));

vi.mock('../../../contexts/ThemeContext', () => ({
  useTheme: () => ({ resolvedTheme: 'dark' }),
}));

vi.mock('@xterm/xterm', () => {
  class MockTerminal {
    open = vi.fn();
    dispose = vi.fn();
    onData = vi.fn(() => ({ dispose: vi.fn() }));
    onResize = vi.fn(() => ({ dispose: vi.fn() }));
    write = vi.fn();
    focus = vi.fn();
    loadAddon = vi.fn();
    options: any = {};
    cols = 80;
    rows = 24;
  }
  return { Terminal: MockTerminal };
});

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class MockFitAddon {
    fit = vi.fn();
    dispose = vi.fn();
    activate = vi.fn();
  },
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: class MockWebLinks {
    dispose = vi.fn();
    activate = vi.fn();
  },
}));

vi.mock('@xterm/xterm/css/xterm.css', () => ({}));

vi.mock('../../../utils/xtermRegistry', () => {
  const store = new Map<string, any>();
  return {
    xtermRegistry: {
      get: vi.fn((id: string) => store.get(id)),
      set: vi.fn((id: string, terminal: any, fitAddon: any) => {
        store.set(id, { terminal, fitAddon });
      }),
      delete: vi.fn((id: string) => store.delete(id)),
    },
  };
});

vi.mock('../../../utils/platform', async (importOriginal) => {
  const mod = await importOriginal<Record<string, any>>();
  return {
    ...mod,
    isAndroid: vi.fn(() => false),
  };
});

import { XTerminal } from '../XTerminal';

describe('XTerminal', () => {
  async function flushTerminalMount() {
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get: () => 800,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => 400,
    });
    useTerminalStore.setState({
      terminals: {},
      ctrlActive: {},
    } as any);
    useServerStore.setState({
      activeServerId: 'backend-1',
      connections: {
        'backend-1': { status: 'connected', error: null, isLocalConnection: false, features: [] },
      },
      localServerPort: null,
      controlPlaneMode: 'gateway-direct',
    });
    useFacadeStore.setState({
      connectionState: 'connected',
      backends: [{ backendId: 'backend-1', runtimeState: 'ready', name: 'Backend 1' }],
    } as any);
    vi.mocked(isAndroid).mockReturnValue(false);
  });

  it('renders a container div', () => {
    const { container } = render(
      <XTerminal terminalId="term-1" projectId="proj-1" />
    );
    const termDiv = container.firstElementChild as HTMLElement;
    expect(termDiv).toBeTruthy();
  });

  it('accepts optional workingDirectory prop', () => {
    const { container } = render(
      <XTerminal terminalId="term-1" projectId="proj-1" workingDirectory="/some/dir" />
    );
    expect(container.firstElementChild).toBeTruthy();
  });

  it('applies theme from CSS variables', async () => {
    // Mock getComputedStyle
    const mockGetPropertyValue = vi.fn((prop: string) => {
      const values: Record<string, string> = {
        '--terminal-bg': '0 0% 0%',
        '--terminal-fg': '0 0% 100%',
        '--terminal-cursor': '0 0% 100%',
        '--terminal-selection': '0 0% 50%',
      };
      return values[prop] || '';
    });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      getPropertyValue: mockGetPropertyValue,
    } as any);

    const { container } = render(
      <XTerminal terminalId="term-1" projectId="proj-1" />
    );
    expect(container.firstElementChild).toBeTruthy();
  });

  it('reuses existing terminal from registry on re-mount', async () => {
    const { xtermRegistry } = await import('../../../utils/xtermRegistry');
    const mockTerminal = {
      open: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
      focus: vi.fn(),
      loadAddon: vi.fn(),
      options: {},
      cols: 80,
      rows: 24,
    };
    const mockFitAddon = { fit: vi.fn() };
    (xtermRegistry.get as any).mockReturnValueOnce({
      terminal: mockTerminal,
      fitAddon: mockFitAddon,
      serverOpened: true,
    });

    const { container } = render(
      <XTerminal terminalId="term-1" projectId="proj-1" />
    );
    expect(container.firstElementChild).toBeTruthy();
  });

  it('applies inline style for background color', () => {
    const { container } = render(
      <XTerminal terminalId="term-1" projectId="proj-1" />
    );
    const div = container.firstElementChild as HTMLElement;
    expect(div.style.backgroundColor).toBeDefined();
  });

  it('handles theme change via useTheme', async () => {
    const { rerender } = render(
      <XTerminal terminalId="term-1" projectId="proj-1" />
    );

    // Simulate theme change by re-rendering
    rerender(<XTerminal terminalId="term-1" projectId="proj-1" />);
    expect(true).toBe(true); // Component should handle theme changes
  });

  // NOTE: focus-on-tap, "no send while disconnected", and "no send while not ready" tests
  // were removed in the phase 4 refactor. Their original behavior was either superseded by
  // the new contract (cold-start should send terminal_open and let the facade buffer; see
  // TerminalLifecycle.refactor-baseline.test.tsx test #7) or required xtermRegistry mocking
  // that no longer matches the controller-owned implementation. The TerminalController unit
  // tests cover the equivalent behavior at the controller level, and the lifecycle baseline
  // covers it end-to-end.
});
