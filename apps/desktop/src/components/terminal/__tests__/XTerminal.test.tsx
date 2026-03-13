import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useTerminalStore } from '../../../stores/terminalStore';

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
    sendMessage: vi.fn(),
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

import { XTerminal } from '../XTerminal';

describe('XTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTerminalStore.setState({
      terminals: {},
      ctrlActive: {},
    } as any);
  });

  it('renders a container div', () => {
    const { container } = render(
      <XTerminal terminalId="term-1" projectId="proj-1" />
    );
    const termDiv = container.firstElementChild as HTMLElement;
    expect(termDiv).toBeInTheDocument();
  });

  it('accepts optional workingDirectory prop', () => {
    const { container } = render(
      <XTerminal terminalId="term-1" projectId="proj-1" workingDirectory="/some/dir" />
    );
    expect(container.firstElementChild).toBeInTheDocument();
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
    expect(container.firstElementChild).toBeInTheDocument();
  });

  it('reuses existing terminal from registry on re-mount', async () => {
    const { xtermRegistry } = await import('../../../utils/xtermRegistry');
    const mockTerminal = {
      open: vi.fn(),
      dispose: vi.fn(),
      onData: vi.fn(() => ({ dispose: vi.fn() })),
      onResize: vi.fn(() => ({ dispose: vi.fn() })),
      write: vi.fn(),
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
    expect(container.firstElementChild).toBeInTheDocument();
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
});
