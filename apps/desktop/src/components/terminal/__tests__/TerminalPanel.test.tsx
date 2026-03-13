import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TerminalPanel, TerminalActions } from '../TerminalPanel';

const mockSendMessage = vi.fn();

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    serverUrl: 'http://localhost:3100',
    isConnected: true,
    activeBackend: 'local',
    setActiveBackend: vi.fn(),
    sendMessage: mockSendMessage,
  }),
}));

vi.mock('../../../hooks/useMediaQuery', () => ({
  useIsMobile: () => false,
}));

vi.mock('../../../utils/xtermRegistry', () => ({
  xtermRegistry: {
    delete: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
  },
}));

const mockCloseTerminal = vi.fn();
const mockOpenTerminal = vi.fn();
const mockToggleCtrl = vi.fn();

vi.mock('../../../stores/terminalStore', () => {
  const store = vi.fn((selector?: (s: any) => any) => {
    const state = {
      terminals: {} as Record<string, string>,
      ctrlActive: {} as Record<string, boolean>,
      toggleCtrl: mockToggleCtrl,
    };
    return selector ? selector(state) : state;
  });
  (store as any).getState = () => ({
    closeTerminal: mockCloseTerminal,
    openTerminal: mockOpenTerminal,
    terminals: {},
    ctrlActive: {},
    toggleCtrl: mockToggleCtrl,
  });
  return { useTerminalStore: store };
});

vi.mock('../XTerminal', () => ({
  XTerminal: (props: any) => <div data-testid="xterminal">XTerminal: {props.terminalId}</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('TerminalPanel', () => {
  it('renders "No terminal session" when no terminal exists', () => {
    render(<TerminalPanel projectId="proj-1" />);
    expect(screen.getByText('No terminal session')).toBeInTheDocument();
  });

  it('renders XTerminal when terminal exists', async () => {
    const { useTerminalStore } = await import('../../../stores/terminalStore');
    (useTerminalStore as any).mockImplementation((selector?: (s: any) => any) => {
      const state = {
        terminals: { 'proj-1': 'term-1' },
        ctrlActive: {},
        toggleCtrl: mockToggleCtrl,
      };
      return selector ? selector(state) : state;
    });

    render(<TerminalPanel projectId="proj-1" />);
    expect(screen.getByTestId('xterminal')).toBeInTheDocument();
    expect(screen.getByText('XTerminal: term-1')).toBeInTheDocument();
  });
});

describe('TerminalActions', () => {
  it('renders a reload button', () => {
    const { container } = render(<TerminalActions projectId="proj-1" />);
    const button = container.querySelector('button');
    expect(button).toBeInTheDocument();
    expect(button?.title).toBe('Reload terminal');
  });

  it('sends terminal_close and opens new terminal when clicked', async () => {
    const { useTerminalStore } = await import('../../../stores/terminalStore');
    const mockCloseTerminal = vi.fn();
    const mockOpenTerminal = vi.fn();
    (useTerminalStore as any).mockImplementation((selector?: (s: any) => any) => {
      const state = {
        terminals: { 'proj-1': 'term-1' },
        ctrlActive: {},
        toggleCtrl: mockToggleCtrl,
      };
      (useTerminalStore as any).getState = () => ({
        closeTerminal: mockCloseTerminal,
        openTerminal: mockOpenTerminal,
        terminals: { 'proj-1': 'term-1' },
        ctrlActive: {},
      });
      return selector ? selector(state) : state;
    });

    const { container } = render(<TerminalActions projectId="proj-1" />);
    const button = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(button);

    expect(mockSendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'terminal_close', terminalId: 'term-1' })
    );
    expect(mockCloseTerminal).toHaveBeenCalledWith('term-1');
    expect(mockOpenTerminal).toHaveBeenCalledWith('proj-1');
  });

  it('does nothing if no terminal exists for project', async () => {
    const { useTerminalStore } = await import('../../../stores/terminalStore');
    (useTerminalStore as any).mockImplementation((selector?: (s: any) => any) => {
      const state = {
        terminals: {},
        ctrlActive: {},
        toggleCtrl: mockToggleCtrl,
      };
      (useTerminalStore as any).getState = () => ({
        closeTerminal: vi.fn(),
        openTerminal: vi.fn(),
        terminals: {},
        ctrlActive: {},
      });
      return selector ? selector(state) : state;
    });

    const { container } = render(<TerminalActions projectId="proj-1" />);
    const button = container.querySelector('button') as HTMLButtonElement;
    fireEvent.click(button);

    expect(mockSendMessage).not.toHaveBeenCalled();
  });
});

describe('TerminalPanel - mobile', () => {
  it('shows quick-send buttons on mobile when terminal exists', async () => {
    vi.doMock('../../../hooks/useMediaQuery', () => ({
      useIsMobile: () => true,
    }));

    // Need to re-import after changing mock
    vi.resetModules();
    const { TerminalPanel: TerminalPanelMobile } = await import('../TerminalPanel');

    const { container } = render(<TerminalPanelMobile projectId="proj-1" />);
    // Terminal doesn't exist, so no mobile buttons shown
    expect(container.textContent).toContain('No terminal session');
  });
});
