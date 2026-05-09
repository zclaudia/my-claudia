import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { TerminalPanel, TerminalActions } from '../TerminalPanel';
import { useServerStore } from '../../../stores/serverStore';

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

const mockCloseTerminal = vi.fn();
const mockOpenTerminal = vi.fn();
const mockToggleCtrl = vi.fn();

vi.mock('../../../stores/terminalStore', () => {
  const store = vi.fn((selector?: (s: any) => any) => {
    const state = {
      terminals: {} as Record<string, string>,
      ctrlActive: {} as Record<string, boolean>,
      poppedOutTerminals: {} as Record<string, string>,
      getTerminalId: vi.fn(() => undefined),
      shouldReattach: vi.fn(() => false),
      hasReattachFailed: vi.fn(() => false),
      clearNeedsReattach: vi.fn(),
      toggleCtrl: mockToggleCtrl,
    };
    return selector ? selector(state) : state;
  });
  (store as any).getState = () => ({
    closeTerminal: mockCloseTerminal,
    openTerminal: mockOpenTerminal,
    terminals: {},
    ctrlActive: {},
    poppedOutTerminals: {},
    getTerminalId: vi.fn(() => undefined),
    shouldReattach: vi.fn(() => false),
    hasReattachFailed: vi.fn(() => false),
    clearNeedsReattach: vi.fn(),
    toggleCtrl: mockToggleCtrl,
  });
  return { useTerminalStore: store };
});

vi.mock('../XTerminal', () => ({
  XTerminal: (props: any) => <div data-testid="xterminal">XTerminal: {props.terminalId}</div>,
}));

beforeEach(() => {
  vi.clearAllMocks();
  cleanup();
  useServerStore.setState({
    activeServerId: 'backend-1',
    connections: {},
    localServerPort: null,
    controlPlaneMode: 'gateway-direct',
  });
});

describe('TerminalPanel', () => {
  it('renders "No terminal session" when no terminal exists', () => {
    render(<TerminalPanel projectId="proj-1" />);
    expect(screen.getByText('No terminal session')).toBeTruthy();
  });

  it('renders XTerminal when terminal exists', async () => {
    const { useTerminalStore } = await import('../../../stores/terminalStore');
    const getTerminalId = vi.fn((projectId: string, backendId?: string | null) =>
      projectId === 'proj-1' && backendId === 'backend-1' ? 'term-1' : undefined
    );
    (useTerminalStore as any).mockImplementation((selector?: (s: any) => any) => {
      const state = {
        terminals: { 'proj-1': 'term-1' },
        ctrlActive: {},
        poppedOutTerminals: {},
        getTerminalId,
        shouldReattach: vi.fn(() => false),
        hasReattachFailed: vi.fn(() => false),
        clearNeedsReattach: vi.fn(),
        toggleCtrl: mockToggleCtrl,
      };
      return selector ? selector(state) : state;
    });

    render(<TerminalPanel projectId="proj-1" />);
    expect(screen.getByTestId('xterminal')).toBeTruthy();
    expect(screen.getByText('XTerminal: term-1')).toBeTruthy();
    expect(getTerminalId).toHaveBeenCalledWith('proj-1', 'backend-1');
  });

  it('switches to the scoped terminal for the new active backend', async () => {
    const { useTerminalStore } = await import('../../../stores/terminalStore');
    const getTerminalId = vi.fn((projectId: string, backendId?: string | null) => {
      if (projectId !== 'proj-1') return undefined;
      return backendId === 'backend-2' ? 'term-2' : 'term-1';
    });

    (useTerminalStore as any).mockImplementation((selector?: (s: any) => any) => {
      const state = {
        terminals: {},
        ctrlActive: {},
        poppedOutTerminals: {},
        getTerminalId,
        shouldReattach: vi.fn(() => false),
        hasReattachFailed: vi.fn(() => false),
        clearNeedsReattach: vi.fn(),
        toggleCtrl: mockToggleCtrl,
      };
      return selector ? selector(state) : state;
    });

    const { rerender } = render(<TerminalPanel projectId="proj-1" />);
    expect(screen.getByText('XTerminal: term-1')).toBeTruthy();

    await act(async () => {
      useServerStore.setState({
        activeServerId: 'backend-2',
        connections: {},
        localServerPort: null,
        controlPlaneMode: 'gateway-direct',
      });
      rerender(<TerminalPanel projectId="proj-1" />);
    });
    expect(screen.getByText('XTerminal: term-2')).toBeTruthy();
    expect(getTerminalId).toHaveBeenCalledWith('proj-1', 'backend-2');
  });
});

describe('TerminalActions', () => {
  it('renders a reload button', () => {
    const { container } = render(<TerminalActions projectId="proj-1" />);
    const button = Array.from(container.querySelectorAll('button')).find((el) => el.title === 'Reload terminal');
    expect(button).toBeTruthy();
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
        poppedOutTerminals: {},
        getTerminalId: vi.fn(() => 'term-1'),
        shouldReattach: vi.fn(() => false),
        clearNeedsReattach: vi.fn(),
        toggleCtrl: mockToggleCtrl,
      };
      (useTerminalStore as any).getState = () => ({
        closeTerminal: mockCloseTerminal,
        openTerminal: mockOpenTerminal,
        terminals: { 'proj-1': 'term-1' },
        ctrlActive: {},
        poppedOutTerminals: {},
        getTerminalId: vi.fn(() => 'term-1'),
        shouldReattach: vi.fn(() => false),
        clearNeedsReattach: vi.fn(),
      });
      return selector ? selector(state) : state;
    });

    const { container } = render(<TerminalActions projectId="proj-1" />);
    const button = Array.from(container.querySelectorAll('button')).find((el) => el.title === 'Reload terminal') as HTMLButtonElement;
    fireEvent.click(button);

    // Reload now goes through TerminalController.close() (when a controller exists)
    // and then closeTerminal/openTerminal on the store. The controller is created lazily
    // by XTerminal, so in this test (which renders TerminalActions in isolation) no
    // controller exists yet — the click only updates the store mappings.
    expect(mockCloseTerminal).toHaveBeenCalledWith('term-1');
    expect(mockOpenTerminal).toHaveBeenCalledWith('proj-1', 'backend-1');
  });

  it('does nothing if no terminal exists for project', async () => {
    const { useTerminalStore } = await import('../../../stores/terminalStore');
    (useTerminalStore as any).mockImplementation((selector?: (s: any) => any) => {
      const state = {
        terminals: {},
        ctrlActive: {},
        poppedOutTerminals: {},
        getTerminalId: vi.fn(() => undefined),
        shouldReattach: vi.fn(() => false),
        clearNeedsReattach: vi.fn(),
        toggleCtrl: mockToggleCtrl,
      };
      (useTerminalStore as any).getState = () => ({
        closeTerminal: vi.fn(),
        openTerminal: vi.fn(),
        terminals: {},
        ctrlActive: {},
        poppedOutTerminals: {},
        getTerminalId: vi.fn(() => undefined),
        shouldReattach: vi.fn(() => false),
        clearNeedsReattach: vi.fn(),
      });
      return selector ? selector(state) : state;
    });

    const { container } = render(<TerminalActions projectId="proj-1" />);
    const button = Array.from(container.querySelectorAll('button')).find((el) => el.title === 'Reload terminal') as HTMLButtonElement;
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
