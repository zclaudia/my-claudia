import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBottomPanelStore } from '../bottomPanelStore';
import { useDraftEditorStore } from '../draftEditorStore';
import { usePluginStore } from '../pluginStore';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  lockSessionDraft: vi.fn(),
  getSessionDraft: vi.fn(),
  upsertSessionDraft: vi.fn(),
  deleteSessionDraft: vi.fn(),
  unlockSessionDraft: vi.fn(),
  archiveSessionDraft: vi.fn(),
}));

describe('draftEditorStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    useDraftEditorStore.setState({
      draftExists: {},
      activeSessionId: null,
      localContent: '',
      isSaving: false,
      lastSavedAt: null,
      isReadOnly: false,
      isLocked: false,
      lockedByDevice: null,
      showLockPrompt: false,
      poppedOut: false,
      poppedOutWindowLabel: null,
      sendCallback: null,
      sessionArchived: false,
    });

    usePluginStore.setState({
      plugins: [],
      isLoading: false,
      error: null,
      panels: [],
      settingsTabs: [],
      toolbarItems: [],
      settings: {},
      disabledBuiltinPanels: [],
    } as any);

    useBottomPanelStore.setState({ activeTab: '' });
  });

  it('does not mark an empty server draft as existing when opening the editor', async () => {
    vi.mocked(api.lockSessionDraft).mockResolvedValue({ locked: true, draft: null } as any);

    await useDraftEditorStore.getState().openEditor('session-1');

    expect(useDraftEditorStore.getState().draftExists['session-1']).toBe(false);
  });

  it('treats whitespace-only drafts as non-existent', async () => {
    vi.mocked(api.getSessionDraft).mockResolvedValue({ content: '   ' } as any);

    const exists = await useDraftEditorStore.getState().checkDraftExists('session-1');

    expect(exists).toBe(false);
    expect(useDraftEditorStore.getState().draftExists['session-1']).toBe(false);
  });

  it('deletes empty drafts instead of keeping the blue dot on close', async () => {
    vi.mocked(api.deleteSessionDraft).mockResolvedValue(undefined as any);
    vi.mocked(api.unlockSessionDraft).mockResolvedValue(undefined as any);

    useDraftEditorStore.setState({
      activeSessionId: 'session-1',
      localContent: '   ',
      isReadOnly: false,
      draftExists: { 'session-1': true },
    });

    await useDraftEditorStore.getState().closeEditor();

    expect(api.deleteSessionDraft).toHaveBeenCalledWith('session-1');
    expect(useDraftEditorStore.getState().draftExists['session-1']).toBe(false);
  });
});
