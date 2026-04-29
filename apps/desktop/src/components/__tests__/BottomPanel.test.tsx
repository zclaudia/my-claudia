import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePluginStore } from '../../stores/pluginStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';

// Mock PluginPanelRenderer (used for iframe panels)
vi.mock('../notch/PluginPanelRenderer', () => ({
  PluginPanelRenderer: ({ activePluginPanelId }: any) => <div data-testid="plugin-panel">Plugin:{activePluginPanelId}</div>,
}));

// Mock providerMetaStore (used by projectStore internally)
const { mockProviderMetaStore } = vi.hoisted(() => {
  const state = {
    providersByBackend: {},
    providerCommands: {},
    providerCapabilities: {},
    setProviders: vi.fn(),
    getProviders: vi.fn().mockReturnValue([]),
    setProviderCommands: vi.fn(),
    setProviderCapabilities: vi.fn(),
  };
  const store: any = (selector?: (s: any) => any) => selector ? selector(state) : state;
  store.getState = () => state;
  store.setState = vi.fn();
  store.subscribe = vi.fn(() => vi.fn());
  store.destroy = vi.fn();
  return { mockProviderMetaStore: store };
});
vi.mock('../../stores/providerMetaStore', () => ({
  useProviderMetaStore: mockProviderMetaStore,
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
import { useIsMobile } from '../../hooks/useMediaQuery';

// Helper: register a terminal panel (alwaysMount)
const TerminalPanel = ({ projectId }: any) => <div data-testid="terminal-panel">Terminal:{projectId}</div>;
const TerminalActions = ({ projectId }: any) => <div data-testid="terminal-actions">Actions:{projectId}</div>;
const FileViewerPanel = ({ projectRoot }: any) => <div data-testid="fileviewer-panel">FileViewer:{projectRoot}</div>;
const FileViewerActions = () => <div data-testid="fileviewer-actions">FileActions</div>;

const mockTerminalOnClose = vi.fn();
const mockFileViewerOnClose = vi.fn();

function registerTerminalPanel(visible: boolean) {
  usePluginStore.getState().registerPanel({
    id: 'terminal',
    pluginId: 'com.claudia.terminal',
    type: 'panel',
    label: 'Terminal',
    icon: 'Terminal',
    component: TerminalPanel,
    actions: TerminalActions,
    order: 0,
    platforms: ['desktop', 'mobile'],
    alwaysMount: true,
    visible,
    onClose: mockTerminalOnClose,
  });
}

function registerFileViewerPanel(visible = true) {
  usePluginStore.getState().registerPanel({
    id: 'file-viewer',
    pluginId: 'com.claudia.file-viewer',
    type: 'panel',
    label: 'File',
    icon: 'File',
    component: FileViewerPanel,
    actions: FileViewerActions,
    order: 1,
    platforms: ['desktop', 'mobile'],
    visible,
    onClose: mockFileViewerOnClose,
  });
}

function registerPluginPanel(id: string, label: string) {
  usePluginStore.getState().registerPanel({
    id,
    pluginId: `com.test.${id}`,
    type: 'panel',
    label,
    order: 50,
    iframeUrl: `/api/plugins/${id}/frontend/index.html`,
  });
}

describe('BottomPanel', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [], panelPlacements: {} });
    useBottomPanelStore.setState({ activeTab: 'terminal' });
    mockTerminalOnClose.mockClear();
    mockFileViewerOnClose.mockClear();
    (useIsMobile as any).mockReturnValue(false);
  });

  // ── Basic rendering ─────────────────────────────────────────────────────

  it('renders without crashing', () => {
    const { container } = render(
      <BottomPanel projectId="p1" projectRoot="/test" />
    );
    expect(container).toBeDefined();
  });

  it('returns null when no panels are registered', () => {
    const { container } = render(
      <BottomPanel projectId="p1" projectRoot="/test" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when projectId is undefined and nothing is registered', () => {
    const { container } = render(
      <BottomPanel projectId={undefined} projectRoot={undefined} />
    );
    expect(container.firstChild).toBeNull();
  });

  // ── Terminal panel (alwaysMount) ──────────────────────────────────────────

  it('renders terminal panel when visible', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  it('renders terminal actions when terminal tab is active', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('terminal-actions')).toBeInTheDocument();
  });

  it('panel has correct height when open', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.height).toBe('300px');
  });

  it('keeps DOM mounted but at height 0 when alwaysMount panel is hidden', () => {
    registerTerminalPanel(false); // visible=false but alwaysMount=true

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const panel = container.firstChild as HTMLElement;
    expect(panel.style.height).toBe('0px');
    // Terminal should still be in DOM (invisible)
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  // ── File viewer panel ───────────────────────────────────────────────────

  it('renders file viewer panel when visible', () => {
    registerTerminalPanel(false);
    registerFileViewerPanel(true);
    useBottomPanelStore.setState({ activeTab: 'file-viewer' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('fileviewer-panel')).toBeInTheDocument();
  });

  it('renders file viewer actions when file tab is active', () => {
    registerTerminalPanel(false);
    registerFileViewerPanel(true);
    useBottomPanelStore.setState({ activeTab: 'file-viewer' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('fileviewer-actions')).toBeInTheDocument();
  });

  // ── Tab switching ──────────────────────────────────────────────────────

  it('shows tab buttons when both terminal and file viewer are visible', () => {
    registerTerminalPanel(true);
    registerFileViewerPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('switches to file tab when File button is clicked', () => {
    registerTerminalPanel(true);
    registerFileViewerPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByText('File'));
    expect(useBottomPanelStore.getState().activeTab).toBe('file-viewer');
  });

  it('switches to terminal tab when Terminal button is clicked', () => {
    registerTerminalPanel(true);
    registerFileViewerPanel(true);
    useBottomPanelStore.setState({ activeTab: 'file-viewer' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByText('Terminal'));
    expect(useBottomPanelStore.getState().activeTab).toBe('terminal');
  });

  it('shows single tab label when only terminal is visible', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const terminalLabels = screen.getAllByText('Terminal');
    expect(terminalLabels.length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText('File')).not.toBeInTheDocument();
  });

  it('shows single tab label when only file viewer is visible', () => {
    registerTerminalPanel(false);
    registerFileViewerPanel(true);
    useBottomPanelStore.setState({ activeTab: 'file-viewer' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const fileLabels = screen.getAllByText('File');
    expect(fileLabels.length).toBeGreaterThanOrEqual(1);
  });

  // ── Close button ───────────────────────────────────────────────────────

  it('renders close button when panel is open', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTitle('Hide panel')).toBeInTheDocument();
  });

  it('calls onClose of visible panels when close button is clicked', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Hide panel'));
    expect(mockTerminalOnClose).toHaveBeenCalled();
  });

  it('calls onClose of file viewer when close button clicked with file tab active', () => {
    registerTerminalPanel(false);
    registerFileViewerPanel(true);
    useBottomPanelStore.setState({ activeTab: 'file-viewer' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Hide panel'));
    expect(mockFileViewerOnClose).toHaveBeenCalled();
  });

  // ── Drag handle ────────────────────────────────────────────────────────

  it('renders drag handle area', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const dragHandle = container.querySelector('.cursor-ns-resize');
    expect(dragHandle).toBeInTheDocument();
  });

  it('resizes on drag (mousedown + mousemove)', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const dragHandle = container.querySelector('.cursor-ns-resize')!;
    const panel = container.firstChild as HTMLElement;

    expect(panel.style.height).toBe('300px');

    fireEvent.mouseDown(dragHandle, { clientY: 500 });
    fireEvent.mouseMove(document, { clientY: 400 });
    fireEvent.mouseUp(document);

    expect(panel.style.height).toBe('400px');
  });

  // ── Plugin tabs ────────────────────────────────────────────────────────

  it('shows plugin tab when plugin panels are registered', () => {
    registerTerminalPanel(true);
    registerPluginPanel('my-plugin', 'My Plugin');
    useBottomPanelStore.setState({ activeTab: 'my-plugin' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByText('My Plugin')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-panel')).toBeInTheDocument();
  });

  it('switches to plugin tab when clicked', () => {
    registerTerminalPanel(true);
    registerPluginPanel('my-plugin', 'My Plugin');
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByText('My Plugin'));
    expect(useBottomPanelStore.getState().activeTab).toBe('my-plugin');
  });

  // ── Tab fallback logic ────────────────────────────────────────────────

  it('falls back to file-viewer tab when terminal is hidden but file viewer is visible', () => {
    registerTerminalPanel(false);
    registerFileViewerPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' }); // terminal not visible

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('fileviewer-panel')).toBeInTheDocument();
  });

  it('falls back to terminal when file viewer is removed but terminal is visible', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'file-viewer' }); // file-viewer not registered

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  // ── Platform filtering ────────────────────────────────────────────────

  it('filters panels by platform (desktop)', () => {
    usePluginStore.getState().registerPanel({
      id: 'desktop-only',
      pluginId: 'test',
      type: 'panel',
      label: 'Desktop Only',
      component: () => <div data-testid="desktop-only">Desktop</div>,
      platforms: ['desktop'],
      order: 0,
    });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('desktop-only')).toBeInTheDocument();
  });

  it('hides desktop-only panels on mobile', () => {
    (useIsMobile as any).mockReturnValue(true);
    usePluginStore.getState().registerPanel({
      id: 'desktop-only',
      pluginId: 'test',
      type: 'panel',
      label: 'Desktop Only',
      component: () => <div data-testid="desktop-only">Desktop</div>,
      platforms: ['desktop'],
      order: 0,
    });

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  // ── Mobile mode ────────────────────────────────────────────────────────

  it('renders fullscreen overlay on mobile when open', () => {
    (useIsMobile as any).mockReturnValue(true);
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const fixedDiv = container.querySelector('.fixed.inset-0');
    expect(fixedDiv).toBeInTheDocument();
  });

  it('renders close button on mobile', () => {
    (useIsMobile as any).mockReturnValue(true);
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTitle('Close panel')).toBeInTheDocument();
  });

  it('mobile close button calls onClose', () => {
    (useIsMobile as any).mockReturnValue(true);
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Close panel'));
    expect(mockTerminalOnClose).toHaveBeenCalled();
  });

  it('mobile shows tabs when both terminal and file viewer are visible', () => {
    (useIsMobile as any).mockReturnValue(true);
    registerTerminalPanel(true);
    registerFileViewerPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  // ── Border / overflow styling ──────────────────────────────────────────

  it('has border-t when open on desktop', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const panel = container.firstChild as HTMLElement;
    expect(panel.className).toContain('border-t');
  });

  it('does not have border-t when closed on desktop', () => {
    registerTerminalPanel(false); // alwaysMount but hidden → height 0

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    const panel = container.firstChild as HTMLElement;
    expect(panel.className).not.toContain('border-t');
  });

  // ── Placement filtering ───────────────────────────────────────────────

  it('filters out panels with placement=right on desktop', () => {
    registerTerminalPanel(true);
    registerFileViewerPanel(true);
    usePluginStore.setState({ panelPlacements: { 'file-viewer': 'right' } });
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.queryByText('File')).toBeNull(); // file-viewer tab hidden
    expect(screen.getByText('Terminal')).toBeInTheDocument();
  });

  it('honors defaultPlacement=right', () => {
    usePluginStore.getState().registerPanel({
      id: 'rightside',
      pluginId: 'test',
      type: 'panel',
      label: 'Rightside',
      component: () => <div data-testid="rightside">RS</div>,
      defaultPlacement: 'right',
      visible: true,
      order: 0,
    });

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  it('user override beats defaultPlacement (right→bottom)', () => {
    usePluginStore.getState().registerPanel({
      id: 'rightside',
      pluginId: 'test',
      type: 'panel',
      label: 'Rightside',
      component: () => <div data-testid="rightside">RS</div>,
      defaultPlacement: 'right',
      visible: true,
      order: 0,
    });
    usePluginStore.setState({ panelPlacements: { rightside: 'bottom' } });
    useBottomPanelStore.setState({ activeTab: 'rightside' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('rightside')).toBeInTheDocument();
  });

  it('mobile ignores placement and shows all visible panels', () => {
    (useIsMobile as any).mockReturnValue(true);
    registerTerminalPanel(true);
    registerFileViewerPanel(true);
    usePluginStore.setState({ panelPlacements: { terminal: 'right', 'file-viewer': 'right' } });
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    const { container } = render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(container.querySelector('.fixed.inset-0')).toBeInTheDocument();
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('shows "Move to right sidebar" button on desktop when a panel is active', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    expect(screen.getByTitle('Move to right sidebar')).toBeInTheDocument();
  });

  it('clicking "Move to right sidebar" updates placement to right', () => {
    registerTerminalPanel(true);
    useBottomPanelStore.setState({ activeTab: 'terminal' });

    render(<BottomPanel projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Move to right sidebar'));
    expect(usePluginStore.getState().panelPlacements.terminal).toBe('right');
  });
});
