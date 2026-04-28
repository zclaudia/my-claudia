import { create } from 'zustand';
import type { SessionDraft } from '@my-claudia/shared';
import * as api from '../services/api';
import { usePluginStore } from './pluginStore';
import { activatePanel, deactivatePanel } from '../utils/openPanel';

// Generate a stable client ID per browser tab for lock identification
const CLIENT_DEVICE_ID = crypto.randomUUID();

const SAVE_DEBOUNCE_MS = 1500;

interface DraftEditorState {
  // Server draft existence cache (sessionId → boolean)
  draftExists: Record<string, boolean>;

  // Editor state
  activeSessionId: string | null;
  localContent: string;
  isSaving: boolean;
  lastSavedAt: number | null;
  isReadOnly: boolean;

  // Lock state
  isLocked: boolean;
  lockedByDevice: string | null;
  showLockPrompt: boolean;

  // Pop-out window tracking
  poppedOut: boolean;
  poppedOutWindowLabel: string | null;

  // Callback for Finish & Send (injected by ChatInterface)
  sendCallback: ((content: string) => void) | null;

  // Session archived flag (for independent windows)
  sessionArchived: boolean;

  // Actions
  openEditor: (sessionId: string) => Promise<void>;
  closeEditor: () => Promise<void>;
  forceOpen: (sessionId: string) => Promise<void>;
  openReadOnly: (sessionId: string) => void;
  setLocalContent: (content: string) => void;
  checkDraftExists: (sessionId: string) => Promise<boolean>;
  finishDraft: (sendCallback: (content: string) => void) => Promise<void>;
  discardDraft: () => Promise<void>;
  dismissLockPrompt: () => void;
  setSendCallback: (cb: ((content: string) => void) | null) => void;
  setPoppedOut: (poppedOut: boolean, label: string | null) => void;
  setSessionArchived: (archived: boolean) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function hasDraftContent(content: string | null | undefined): boolean {
  return !!content?.trim();
}

async function saveDraftToServer(sessionId: string, content: string): Promise<SessionDraft | null> {
  try {
    const draft = await api.upsertSessionDraft(sessionId, content, CLIENT_DEVICE_ID);
    return draft;
  } catch (error) {
    console.error('[DraftEditor] Failed to save draft:', error);
    return null;
  }
}

function showDraftPanel() {
  usePluginStore.getState().updatePanelVisibility('draft', true);
  activatePanel('draft');
}

function hideDraftPanel() {
  usePluginStore.getState().updatePanelVisibility('draft', false);
  // Reset active tab in the bottom panel so toolbar buttons update immediately.
  // For right placement, sidebar collapses on its own once the panel is hidden.
  deactivatePanel('draft');
}

export const useDraftEditorStore = create<DraftEditorState>((set, get) => ({
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

  openEditor: async (sessionId: string) => {
    // If switching from a previous session, flush its pending save and
    // release its lock in the background — otherwise the previous draft
    // is lost and the lock leaks until the TTL expires.
    const prev = get();
    if (prev.activeSessionId && prev.activeSessionId !== sessionId && !prev.isReadOnly) {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
      }
      const prevSession = prev.activeSessionId;
      const prevContent = prev.localContent;
      if (hasDraftContent(prevContent)) {
        saveDraftToServer(prevSession, prevContent).catch((err) =>
          console.error('[DraftEditor] Background save on switch failed:', err)
        );
      } else {
        set({ draftExists: { ...get().draftExists, [prevSession]: false } });
        api.deleteSessionDraft(prevSession).catch((err) =>
          console.error('[DraftEditor] Failed to delete empty draft on switch:', err)
        );
      }
      api.unlockSessionDraft(prevSession, CLIENT_DEVICE_ID).catch((err) =>
        console.error('[DraftEditor] Failed to release lock on switch:', err)
      );
    }

    // Show panel immediately with empty content for responsive UI
    set({
      activeSessionId: sessionId,
      localContent: '',
      isReadOnly: false,
      isLocked: false,
      lockedByDevice: null,
      showLockPrompt: false,
      sessionArchived: false,
    });
    showDraftPanel();

    // Then load draft content and acquire lock in background
    try {
      const result = await api.lockSessionDraft(sessionId, CLIENT_DEVICE_ID);

      if (result.locked) {
        set({
          localContent: result.draft?.content || '',
          lastSavedAt: result.draft?.updatedAt || null,
          draftExists: { ...get().draftExists, [sessionId]: hasDraftContent(result.draft?.content) },
        });
      } else {
        // Lock held by another device
        set({
          isLocked: true,
          lockedByDevice: result.draft?.editingBy || null,
          showLockPrompt: true,
          localContent: result.draft?.content || '',
        });
      }
    } catch (error) {
      console.error('[DraftEditor] Failed to open editor:', error);
    }
  },

  closeEditor: async () => {
    const { activeSessionId, isReadOnly, localContent } = get();

    // Clear pending save timer
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    // Hide panel and reset state immediately for responsive UI
    hideDraftPanel();
    set({
      activeSessionId: null,
      localContent: '',
      isReadOnly: false,
      isLocked: false,
      lockedByDevice: null,
      showLockPrompt: false,
      lastSavedAt: null,
      sendCallback: null,
      sessionArchived: false,
    });

    // Save and release lock in background (don't block UI)
    if (activeSessionId && !isReadOnly) {
      if (hasDraftContent(localContent)) {
        saveDraftToServer(activeSessionId, localContent).catch((err) =>
          console.error('[DraftEditor] Background save failed:', err)
        );
      } else {
        set({ draftExists: { ...get().draftExists, [activeSessionId]: false } });
        api.deleteSessionDraft(activeSessionId).catch((err) =>
          console.error('[DraftEditor] Failed to delete empty draft:', err)
        );
      }
      api.unlockSessionDraft(activeSessionId, CLIENT_DEVICE_ID).catch((err) =>
        console.error('[DraftEditor] Failed to release lock:', err)
      );
    }
  },

  forceOpen: async (sessionId: string) => {
    try {
      const result = await api.lockSessionDraft(sessionId, CLIENT_DEVICE_ID, true);
      set({
        activeSessionId: sessionId,
        localContent: result.draft?.content || '',
        isReadOnly: false,
        isLocked: false,
        lockedByDevice: null,
        showLockPrompt: false,
        lastSavedAt: result.draft?.updatedAt || null,
        sessionArchived: false,
        draftExists: { ...get().draftExists, [sessionId]: hasDraftContent(result.draft?.content) },
      });
      showDraftPanel();
    } catch (error) {
      console.error('[DraftEditor] Failed to force open:', error);
    }
  },

  openReadOnly: (sessionId: string) => {
    const { localContent } = get();
    set({
      activeSessionId: sessionId,
      localContent,
      isReadOnly: true,
      showLockPrompt: false,
    });
    showDraftPanel();
  },

  setLocalContent: (content: string) => {
    const { activeSessionId, isReadOnly } = get();
    if (!activeSessionId || isReadOnly) return;

    set({ localContent: content });

    // Debounced save
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      set({ isSaving: true });
      if (!hasDraftContent(content)) {
        try {
          await api.deleteSessionDraft(activeSessionId);
          set({
            isSaving: false,
            lastSavedAt: null,
            draftExists: { ...get().draftExists, [activeSessionId]: false },
          });
        } catch (error) {
          console.error('[DraftEditor] Failed to delete empty draft:', error);
          set({ isSaving: false });
        }
        return;
      }

      const draft = await saveDraftToServer(activeSessionId, content);
      if (draft) {
        set({
          isSaving: false,
          lastSavedAt: draft.updatedAt,
          draftExists: { ...get().draftExists, [activeSessionId]: true },
        });
      } else {
        set({ isSaving: false });
      }
    }, SAVE_DEBOUNCE_MS);
  },

  checkDraftExists: async (sessionId: string) => {
    try {
      const draft = await api.getSessionDraft(sessionId);
      const exists = hasDraftContent(draft?.content);
      set({ draftExists: { ...get().draftExists, [sessionId]: exists } });
      return exists;
    } catch {
      return false;
    }
  },

  finishDraft: async (sendCallback: (content: string) => void) => {
    const { activeSessionId, localContent } = get();
    if (!activeSessionId || !localContent.trim()) return;

    // Clear pending save timer
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    // Send the content as a message
    sendCallback(localContent);

    // Archive the draft
    try {
      await api.archiveSessionDraft(activeSessionId);
    } catch (error) {
      console.error('[DraftEditor] Failed to archive draft:', error);
    }

    hideDraftPanel();

    // Update state
    set({
      activeSessionId: null,
      localContent: '',
      isReadOnly: false,
      isLocked: false,
      lockedByDevice: null,
      showLockPrompt: false,
      lastSavedAt: null,
      sendCallback: null,
      sessionArchived: false,
      draftExists: { ...get().draftExists, [activeSessionId]: false },
    });
  },

  discardDraft: async () => {
    const { activeSessionId } = get();

    // Clear pending save timer
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }

    if (activeSessionId) {
      try {
        await api.deleteSessionDraft(activeSessionId);
      } catch (error) {
        console.error('[DraftEditor] Failed to discard draft:', error);
      }
    }

    hideDraftPanel();

    set({
      activeSessionId: null,
      localContent: '',
      isReadOnly: false,
      isLocked: false,
      lockedByDevice: null,
      showLockPrompt: false,
      lastSavedAt: null,
      sendCallback: null,
      sessionArchived: false,
      draftExists: activeSessionId
        ? { ...get().draftExists, [activeSessionId]: false }
        : get().draftExists,
    });
  },

  dismissLockPrompt: () => {
    set({
      showLockPrompt: false,
      activeSessionId: null,
      localContent: '',
      isLocked: false,
      lockedByDevice: null,
    });
  },

  setSendCallback: (cb) => set({ sendCallback: cb }),

  setPoppedOut: (poppedOut, label) => set({ poppedOut, poppedOutWindowLabel: label }),

  setSessionArchived: (archived) => set({ sessionArchived: archived }),
}));
