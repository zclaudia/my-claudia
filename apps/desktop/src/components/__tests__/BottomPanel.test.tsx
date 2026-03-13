import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useTerminalStore } from '../../stores/terminalStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { useServerStore } from '../../stores/serverStore';

// Mock heavy child components
vi.mock('../terminal/TerminalPanel', () => ({
  TerminalPanel: ({ projectId }: any) => <div data-testid="terminal-panel">Terminal:{projectId}</div>,
  TerminalActions: ({ projectId }: any) => <div data-testid="terminal-actions">Actions:{projectId}</div>,
}));
vi.mock('../fileviewer/FileViewerPanel', () => ({
  FileViewerPanel: ({ projectRoot }: any) => <div data-testid="fileviewer-panel">FileViewer:{projectRoot}</div>,
  FileViewerActions: () => <div data-testid="fileviewer-actions">FileActions</div>,
}));
vi.mock('../PluginPanelRenderer', () => ({
  PluginPanelRenderer: ({ activePluginPanelId }: any) => <div data-testid="plugin-panel">Plugin:{activePluginPanelId}</div>,
  usePluginPanelTabs: vi.fn().mockReturnValue([]),
}));

// Mock useIsMobile
vi.mock('../../hooks/useMediaQuery', () => ({
  useIsMobile: vi.fn().mockReturnValue(false),
}));

// Mock useAndroidBack
vi.mock('../../hooks/useAndroidBack', () => ({
  useAndroidBack: vi.fn(),
}));

import { BottomPanel } from '../BottomPanel';
import { usePluginPanelTabs } from '../PluginPanelRenderer';
import { useIsMobile } from '../../hooks/useMediaQuery';

describe('BottomPanel', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      drawerOpen: {},
      terminals: {},
      bottomPanelTab: 'terminal',
    } as any);
    useFileViewerStore.setState({
      isOpen: false,
    } as any);
    useServerStore.setState({
      connectionStatus: 'connected',
    } as any);
    (usePluginPanelTabs as any).mockReturnValue([]);
    (useIsMobile as any).mockReturnValue(false);
  });

  // ── Basic rendering ─────────────────────────────────────────────────────

  it('renders without crashing', () => {
    const { container } = render(
      <BottomPanel projectId="p1" projectRoot="/test" />
    );
    expect(container).toBeDefined();
  });

  it('returns null when no terminal, no file viewer, and no projectId terminal', () => {
    const { container } = render(
      <BottomPanel projectId="p1" projectRoot="/test" />
    );
    // When nothing is open and no terminal exists, it returns null
    expect(container.firstChild).toBeNull();
  });

  it('returns null when projectId is undefined and nothing is open', () => {
    const { container } = render(
      <BottomPanel projectId={undefined} projectRoot={undefined} />
    );
    expect(container.firstChild).toBeNull();
  });

  // ── Terminal panel open ─────────────────────────────────────────────────

  it('renders terminal panel when drawer is open and terminal exists', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  it('renders terminal actions when terminal tab is active', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('terminal-actions')).toBeInTheDocument();
  });

  it('panel has correct height when open', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const panel = container.firstChild as HTMLElement;
    // Default desktop height is 300px
    expect(panel.style.height).toBe('300px');
  });

  it('panel has height 0 when terminal exists but drawer is closed', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: false },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const panel = container.firstChild as HTMLElement;
    // Exists but hidden (height 0) to keep terminal alive
    expect(panel.style.height).toBe('0px');
  });

  // ── File viewer panel ─────────────────────────────────────────────────────

  it('renders file viewer panel when file viewer is open', () => {
    useFileViewerStore.setState({ isOpen: true } as any);
    // Need at least a terminal to keep the component mounted
    useTerminalStore.setState({
      drawerOpen: {},
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'file',
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('fileviewer-panel')).toBeInTheDocument();
  });

  it('renders file viewer actions when file tab is active', () => {
    useFileViewerStore.setState({ isOpen: true } as any);
    useTerminalStore.setState({
      drawerOpen: {},
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'file',
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('fileviewer-actions')).toBeInTheDocument();
  });

  // ── Tab switching ─────────────────────────────────────────────────────────

  it('shows tab buttons when both terminal and file viewer are available', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useFileViewerStore.setState({ isOpen: true } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('switches to file tab when File button is clicked', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useFileViewerStore.setState({ isOpen: true } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByText('File'));
    // After clicking, the store's setBottomPanelTab should be called
    expect(useTerminalStore.getState().bottomPanelTab).toBe('file');
  });

  it('switches to terminal tab when Terminal button is clicked', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'file',
    } as any);
    useFileViewerStore.setState({ isOpen: true } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(useTerminalStore.getState().bottomPanelTab).toBe('terminal');
  });

  it('shows single tab label when only terminal is available', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    // With only one tab, it should show as a label not a button
    const terminalLabels = screen.getAllByText('Terminal');
    expect(terminalLabels.length).toBeGreaterThanOrEqual(1);
    // No File tab button should be present
    expect(screen.queryByText('File')).not.toBeInTheDocument();
  });

  it('shows single tab label when only file viewer is available', () => {
    useFileViewerStore.setState({ isOpen: true } as any);
    // Need a terminal to exist to prevent null return
    useTerminalStore.setState({
      drawerOpen: {},
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'file',
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const fileLabels = screen.getAllByText('File');
    expect(fileLabels.length).toBeGreaterThanOrEqual(1);
  });

  // ── Close button ──────────────────────────────────────────────────────────

  it('renders close button when panel is open', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTitle('Hide panel')).toBeInTheDocument();
  });

  it('closes terminal drawer when close button is clicked', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Hide panel'));
    expect(useTerminalStore.getState().drawerOpen['p1']).toBeFalsy();
  });

  it('closes file viewer when close button is clicked and file tab active', () => {
    useFileViewerStore.setState({ isOpen: true } as any);
    useTerminalStore.setState({
      drawerOpen: {},
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'file',
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Hide panel'));
    expect(useFileViewerStore.getState().isOpen).toBe(false);
  });

  // ── Drag handle ───────────────────────────────────────────────────────────

  it('renders drag handle area', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const dragHandle = container.querySelector('.cursor-ns-resize');
    expect(dragHandle).toBeInTheDocument();
  });

  it('resizes on drag (mousedown + mousemove)', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const dragHandle = container.querySelector('.cursor-ns-resize')!;
    const panel = container.firstChild as HTMLElement;

    // Initial height is 300px
    expect(panel.style.height).toBe('300px');

    // Start drag
    fireEvent.mouseDown(dragHandle, { clientY: 500 });
    // Move up by 100px
    fireEvent.mouseMove(document, { clientY: 400 });
    fireEvent.mouseUp(document);

    // Height should have increased (500 - 400 = 100px added)
    expect(panel.style.height).toBe('400px');
  });

  // ── Plugin tabs ───────────────────────────────────────────────────────────

  it('shows plugin tab when plugin panels are available', () => {
    (usePluginPanelTabs as any).mockReturnValue([
      { id: 'plugin:my-plugin', label: 'My Plugin' },
    ]);
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'plugin:my-plugin',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByText('My Plugin')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-panel')).toBeInTheDocument();
  });

  it('switches to plugin tab when clicked', () => {
    (usePluginPanelTabs as any).mockReturnValue([
      { id: 'plugin:my-plugin', label: 'My Plugin' },
    ]);
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByText('My Plugin'));
    expect(useTerminalStore.getState().bottomPanelTab).toBe('plugin:my-plugin');
  });

  // ── Tab fallback logic ────────────────────────────────────────────────────

  it('falls back to file tab when terminal drawer is closed but file viewer is open', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: false },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useFileViewerStore.setState({ isOpen: true } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    // File viewer should be visible since terminal drawer is closed
    expect(screen.getByTestId('fileviewer-panel')).toBeInTheDocument();
  });

  it('falls back to terminal when file viewer is closed but terminal is open', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'file',
    } as any);
    useFileViewerStore.setState({ isOpen: false } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  // ── Mobile mode ───────────────────────────────────────────────────────────

  it('renders fullscreen overlay on mobile when open', () => {
    (useIsMobile as any).mockReturnValue(true);
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    // Mobile renders a fixed overlay
    const fixedDiv = container.querySelector('.fixed.inset-0');
    expect(fixedDiv).toBeInTheDocument();
  });

  it('renders close button on mobile', () => {
    (useIsMobile as any).mockReturnValue(true);
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTitle('Close panel')).toBeInTheDocument();
  });

  it('mobile close button closes the panel', () => {
    (useIsMobile as any).mockReturnValue(true);
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Close panel'));
    expect(useTerminalStore.getState().drawerOpen['p1']).toBeFalsy();
  });

  it('mobile shows tabs when both terminal and file viewer are available', () => {
    (useIsMobile as any).mockReturnValue(true);
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useFileViewerStore.setState({ isOpen: true } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  // ── Border / overflow styling ─────────────────────────────────────────────

  it('has border-t when open on desktop', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: true },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);
    useServerStore.setState({
      activeServerSupports: () => true,
    } as any);

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const panel = container.firstChild as HTMLElement;
    expect(panel.className).toContain('border-t');
  });

  it('does not have border-t when closed on desktop', () => {
    useTerminalStore.setState({
      drawerOpen: { p1: false },
      terminals: { p1: 'term-1' },
      bottomPanelTab: 'terminal',
    } as any);

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const panel = container.firstChild as HTMLElement;
    expect(panel.className).not.toContain('border-t');
  });
});
