import { create } from 'zustand';
import type { SessionDraft } from '@my-claudia/shared';
import * as api from '../services/api';

// Generate a stable client ID per browser tab for lock identification
const CLIENT_DEVICE_ID = crypto.randomUUID();

const SAVE_DEBOUNCE_MS = 1500;

interface DraftEditorState {
  // Server draft existence cache (sessionId → boolean)
  draftExists: Record<string, boolean>;

  // Editor UI state
  isEditorOpen: boolean;
  activeSessionId: string | null;
  localContent: string;
  isSaving: boolean;
  lastSavedAt: number | null;
  isReadOnly: boolean;

  // Lock state
  isLocked: boolean;
  lockedByDevice: string | null;
  showLockPrompt: boolean;

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

export const useDraftEditorStore = create<DraftEditorState>((set, get) => ({
  draftExists: {},
  isEditorOpen: false,
  activeSessionId: null,
  localContent: '',
  isSaving: false,
  lastSavedAt: null,
  isReadOnly: false,
  isLocked: false,
  lockedByDevice: null,
  showLockPrompt: false,

  openEditor: async (sessionId: string) => {
    try {
      const result = await api.lockSessionDraft(sessionId, CLIENT_DEVICE_ID);

      if (result.locked) {
        // Lock acquired successfully
        set({
          isEditorOpen: true,
          activeSessionId: sessionId,
          localContent: result.draft?.content || '',
          isReadOnly: false,
          isLocked: false,
          lockedByDevice: null,
          showLockPrompt: false,
          lastSavedAt: result.draft?.updatedAt || null,
          draftExists: { ...get().draftExists, [sessionId]: true },
        });
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

    set({
      isEditorOpen: false,
      activeSessionId: null,
      localContent: '',
      isReadOnly: false,
      isLocked: false,
      lockedByDevice: null,
      showLockPrompt: false,
      lastSavedAt: null,
    });
  },

  forceOpen: async (sessionId: string) => {
    try {
      const result = await api.lockSessionDraft(sessionId, CLIENT_DEVICE_ID, true);
      set({
        isEditorOpen: true,
        activeSessionId: sessionId,
        localContent: result.draft?.content || '',
        isReadOnly: false,
        isLocked: false,
        lockedByDevice: null,
        showLockPrompt: false,
        lastSavedAt: result.draft?.updatedAt || null,
        draftExists: { ...get().draftExists, [sessionId]: true },
      });
    } catch (error) {
      console.error('[DraftEditor] Failed to force open:', error);
    }
  },

  openReadOnly: (sessionId: string) => {
    const { localContent } = get();
    set({
      isEditorOpen: true,
      activeSessionId: sessionId,
      localContent,
      isReadOnly: true,
      showLockPrompt: false,
    });
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

    // Update state
    set({
      isEditorOpen: false,
      activeSessionId: null,
      localContent: '',
      isReadOnly: false,
      isLocked: false,
      lockedByDevice: null,
      showLockPrompt: false,
      lastSavedAt: null,
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
        await api.archiveSessionDraft(activeSessionId);
      } catch (error) {
        console.error('[DraftEditor] Failed to discard draft:', error);
      }
    }

    set({
      isEditorOpen: false,
      activeSessionId: null,
      localContent: '',
      isReadOnly: false,
      isLocked: false,
      lockedByDevice: null,
      showLockPrompt: false,
      lastSavedAt: null,
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
}));
