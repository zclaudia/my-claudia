import { create } from 'zustand';
import type { SessionDraft } from '@my-claudia/shared';
import * as api from '../services/api';
import { usePluginStore } from './pluginStore';
import { useBottomPanelStore } from './bottomPanelStore';

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
  useBottomPanelStore.getState().setActiveTab('draft');
}

function hideDraftPanel() {
  usePluginStore.getState().updatePanelVisibility('draft', false);
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
    try {
      const result = await api.lockSessionDraft(sessionId, CLIENT_DEVICE_ID);

      if (result.locked) {
        // Lock acquired successfully
        set({
          activeSessionId: sessionId,
          localContent: result.draft?.content || '',
          isReadOnly: false,
          isLocked: false,
          lockedByDevice: null,
          showLockPrompt: false,
          lastSavedAt: result.draft?.updatedAt || null,
          sessionArchived: false,
          draftExists: { ...get().draftExists, [sessionId]: true },
        });
        showDraftPanel();
      } else {
        // Lock held by another device
        set({
          activeSessionId: sessionId,
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

    // Save any unsaved content before closing
    if (activeSessionId && !isReadOnly && localContent) {
      set({ isSaving: true });
      await saveDraftToServer(activeSessionId, localContent);
      set({ isSaving: false });
    }

    // Release lock
    if (activeSessionId && !isReadOnly) {
      try {
        await api.unlockSessionDraft(activeSessionId, CLIENT_DEVICE_ID);
      } catch (error) {
        console.error('[DraftEditor] Failed to release lock:', error);
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
    });
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
        draftExists: { ...get().draftExists, [sessionId]: true },
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
      const exists = draft !== null;
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
