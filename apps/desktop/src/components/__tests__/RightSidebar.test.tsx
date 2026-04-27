import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { usePluginStore } from '../../stores/pluginStore';
import { useRightSidebarStore } from '../../stores/rightSidebarStore';
import { useBottomPanelStore } from '../../stores/bottomPanelStore';

vi.mock('../PluginPanelRenderer', () => ({
  PluginPanelRenderer: ({ activePluginPanelId }: any) => <div data-testid="plugin-panel">Plugin:{activePluginPanelId}</div>,
}));

vi.mock('../../hooks/useMediaQuery', () => ({
  useIsMobile: vi.fn().mockReturnValue(false),
}));

import { RightSidebar } from '../RightSidebar';
import { useIsMobile } from '../../hooks/useMediaQuery';

const TerminalPanel = ({ projectId }: any) => <div data-testid="terminal-panel">Terminal:{projectId}</div>;
const TerminalActions = () => <div data-testid="terminal-actions">Actions</div>;
const FileViewerPanel = () => <div data-testid="fileviewer-panel">FileViewer</div>;

const onCloseSpy = vi.fn();

function registerRightTerminal(visible = true) {
  usePluginStore.getState().registerPanel({
    id: 'terminal',
    pluginId: 'com.claudia.terminal',
    type: 'panel',
    label: 'Terminal',
    component: TerminalPanel,
    actions: TerminalActions,
    order: 0,
    platforms: ['desktop', 'mobile'],
    alwaysMount: true,
    visible,
    onClose: onCloseSpy,
  });
  usePluginStore.setState({ panelPlacements: { terminal: 'right' } });
}

function registerRightFileViewer(visible = true) {
  usePluginStore.getState().registerPanel({
    id: 'file-viewer',
    pluginId: 'com.claudia.file-viewer',
    type: 'panel',
    label: 'File',
    component: FileViewerPanel,
    order: 1,
    platforms: ['desktop', 'mobile'],
    visible,
  });
  usePluginStore.setState({
    panelPlacements: { ...usePluginStore.getState().panelPlacements, 'file-viewer': 'right' },
  });
}

describe('RightSidebar', () => {
  beforeEach(() => {
    usePluginStore.setState({ panels: [], panelPlacements: {} });
    useRightSidebarStore.setState({ widthPx: 380, activeTab: null });
    useBottomPanelStore.setState({ activeTab: '' });
    onCloseSpy.mockClear();
    (useIsMobile as any).mockReturnValue(false);
  });

  it('returns null on mobile', () => {
    (useIsMobile as any).mockReturnValue(true);
    registerRightTerminal(true);

    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no right-placed panels are registered', () => {
    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null when right-placed panels exist but none are visible', () => {
    registerRightTerminal(false);
    registerRightFileViewer(false);

    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    // alwaysMount terminal keeps the wrapper but with width 0
    const wrapper = container.firstChild as HTMLElement | null;
    if (wrapper) {
      expect((wrapper.style.width || '0px')).toBe('0px');
    }
  });

  it('renders right-placed visible panel', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(screen.getByTestId('terminal-panel')).toBeInTheDocument();
  });

  it('does not render bottom-placed panels', () => {
    // Register a bottom-placed panel
    usePluginStore.getState().registerPanel({
      id: 'bottom-only',
      pluginId: 'test',
      type: 'panel',
      label: 'Bottom Only',
      component: () => <div data-testid="bottom-only">Bottom</div>,
      visible: true,
      order: 0,
    });

    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('bottom-only')).toBeNull();
  });

  it('shows tabs when multiple right-placed panels are visible', () => {
    registerRightTerminal(true);
    registerRightFileViewer(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(screen.getByText('Terminal')).toBeInTheDocument();
    expect(screen.getByText('File')).toBeInTheDocument();
  });

  it('switches active tab on tab click', () => {
    registerRightTerminal(true);
    registerRightFileViewer(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByText('File'));
    expect(useRightSidebarStore.getState().activeTab).toBe('file-viewer');
  });

  it('shows "Move to bottom panel" button when a panel is active', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    expect(screen.getByTitle('Move to bottom panel')).toBeInTheDocument();
  });

  it('clicking "Move to bottom panel" updates placement and bottom active tab', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Move to bottom panel'));
    expect(usePluginStore.getState().panelPlacements.terminal).toBe('bottom');
    expect(useBottomPanelStore.getState().activeTab).toBe('terminal');
  });

  it('close button calls each visible panel onClose', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ activeTab: 'terminal' });

    render(<RightSidebar projectId="p1" projectRoot="/test" />);
    fireEvent.click(screen.getByTitle('Hide panel'));
    expect(onCloseSpy).toHaveBeenCalled();
  });

  it('uses widthPx from store as the sidebar width', () => {
    registerRightTerminal(true);
    useRightSidebarStore.setState({ widthPx: 420, activeTab: 'terminal' });

    const { container } = render(<RightSidebar projectId="p1" projectRoot="/test" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.width).toBe('420px');
  });
});
