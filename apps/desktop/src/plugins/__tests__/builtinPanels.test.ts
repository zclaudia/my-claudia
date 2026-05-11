import { describe, it, expect, vi, beforeEach } from 'vitest';
import { usePluginStore } from '../../stores/pluginStore';

// Mock heavy component imports to prevent hangs in test environment
vi.mock('../../components/terminal/TerminalPanel', () => ({
  TerminalPanel: () => null,
  TerminalActions: () => null,
}));
vi.mock('../../components/fileviewer/FileViewerPanel', () => ({
  FileViewerPanel: () => null,
  FileViewerActions: () => null,
}));
vi.mock('../../components/draft/DraftPanel', () => ({
  DraftPanel: () => null,
  DraftActions: () => null,
}));
vi.mock('../../components/notifications/NotificationsPanel', () => ({
  NotificationsPanel: () => null,
}));
vi.mock('../../components/changes/ChangesPanel', () => ({
  ChangesPanel: () => null,
}));
vi.mock('../../stores/terminalStore', () => ({
  useTerminalStore: { getState: () => ({ drawerOpen: {}, setDrawerOpen: vi.fn() }) },
}));
vi.mock('../../stores/fileViewerStore', () => ({
  useFileViewerStore: { getState: () => ({ close: vi.fn() }) },
}));
vi.mock('../../stores/draftEditorStore', () => ({
  useDraftEditorStore: { getState: () => ({ closeEditor: vi.fn() }) },
}));

describe('initBuiltinPanels', () => {
  beforeEach(() => {
    usePluginStore.setState({
      panels: [],
    } as any);
  });

  it('registers terminal, file-viewer, draft, session-changes, and notifications panels', async () => {
    const registerSpy = vi.fn();
    usePluginStore.setState({ registerPanel: registerSpy } as any);

    // Re-import to get fresh module
    const { initBuiltinPanels } = await import('../builtinPanels');
    initBuiltinPanels();

    expect(registerSpy).toHaveBeenCalledTimes(5);
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'terminal', pluginId: 'com.claudia.terminal' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'file-viewer', pluginId: 'com.claudia.file-viewer' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'draft', pluginId: 'com.claudia.draft' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'session-changes', pluginId: 'com.claudia.changes' })
    );
    expect(registerSpy).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'notifications', pluginId: 'com.claudia.notifications' })
    );
  });
});
