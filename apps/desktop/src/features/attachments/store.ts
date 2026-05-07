import { create } from 'zustand';
import type { Attachment, AttachmentOwnerKind } from '@my-claudia/shared';
import {
  listAttachments,
  listAttachmentCounts,
  uploadAttachment,
  deleteAttachment,
  updateAttachment,
  type UploadAttachmentOptions,
} from './api';

/**
 * Owner key — stable identifier used throughout the store. Decoupled from
 * the underlying tuple so a single index supports all owner kinds.
 */
export function ownerKey(kind: AttachmentOwnerKind, id: string): string {
  return `${kind}:${id}`;
}

interface AttachmentsState {
  // Persisted, server-confirmed attachments.
  byOwner: Record<string, Attachment[]>;
  // Lightweight counts for owners we haven't fully loaded yet. Lives next to
  // `byOwner` so realtime add/remove events can keep both in sync. The two
  // collections are independent — owners present only in `byOwner` derive their
  // count from the array length; owners present only in `countsByOwner` show
  // the badge without paying the full list-fetch cost.
  countsByOwner: Record<string, number>;
  // Loading state per owner — prevents duplicate concurrent loads.
  loadingOwners: Record<string, boolean>;

  loadAttachments: (kind: AttachmentOwnerKind, id: string) => Promise<Attachment[]>;
  /** Batch fetch counts for many owners of the same kind. Skips owners we
   *  already have full lists for (those counts come from `byOwner.length`). */
  loadAttachmentCounts: (kind: AttachmentOwnerKind, ids: string[]) => Promise<void>;
  uploadAttachment: (
    kind: AttachmentOwnerKind,
    id: string,
    file: File,
    options?: UploadAttachmentOptions,
  ) => Promise<Attachment>;
  removeAttachment: (id: string, kind: AttachmentOwnerKind, ownerId: string) => Promise<void>;
  renameAttachment: (id: string, name: string) => Promise<Attachment>;
  /**
   * Reorder all attachments of a single owner. Optimistically updates the
   * local list, then sends a PATCH per item to persist new sort orders. The
   * server's `attachment_added` echo will reconcile any drift.
   */
  reorderAttachments: (
    kind: AttachmentOwnerKind,
    ownerId: string,
    orderedIds: string[],
  ) => Promise<void>;

  // Realtime helpers used by the websocket dispatcher.
  upsertFromRemote: (attachment: Attachment) => void;
  removeFromRemote: (kind: AttachmentOwnerKind, ownerId: string, id: string) => void;

  // Selectors — co-located so callers don't have to know how counts are split.
  getCount: (kind: AttachmentOwnerKind, id: string) => number;

  // Test helper — not exported via index.
  __reset: () => void;
}

function sortAttachments(items: Attachment[]): Attachment[] {
  return [...items].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.createdAt - b.createdAt;
  });
}

export const useAttachmentsStore = create<AttachmentsState>((set, get) => ({
  byOwner: {},
  countsByOwner: {},
  loadingOwners: {},

  loadAttachments: async (kind, id) => {
    const key = ownerKey(kind, id);
    if (get().loadingOwners[key]) {
      return get().byOwner[key] ?? [];
    }
    set((state) => ({ loadingOwners: { ...state.loadingOwners, [key]: true } }));
    try {
      const items = sortAttachments(await listAttachments(kind, id));
      set((state) => {
        // Drop the standalone count for this owner — `byOwner.length` is now
        // the source of truth.
        const { [key]: _, ...restCounts } = state.countsByOwner;
        return {
          byOwner: { ...state.byOwner, [key]: items },
          countsByOwner: restCounts,
          loadingOwners: { ...state.loadingOwners, [key]: false },
        };
      });
      return items;
    } catch (error) {
      set((state) => ({ loadingOwners: { ...state.loadingOwners, [key]: false } }));
      throw error;
    }
  },

  loadAttachmentCounts: async (kind, ids) => {
    if (ids.length === 0) return;
    const state = get();
    // Skip owners whose full list is already cached — `byOwner.length` wins.
    const targets = ids.filter((id) => !(ownerKey(kind, id) in state.byOwner));
    if (targets.length === 0) return;
    const results = await listAttachmentCounts(kind, targets);
    set((prev) => {
      const next = { ...prev.countsByOwner };
      // Initialize every requested id (including missing ones) so the UI
      // can distinguish "loaded with 0" from "not yet loaded".
      for (const id of targets) {
        next[ownerKey(kind, id)] = 0;
      }
      for (const row of results) {
        next[ownerKey(row.ownerKind, row.ownerId)] = row.count;
      }
      return { countsByOwner: next };
    });
  },

  uploadAttachment: async (kind, id, file, options) => {
    const attachment = await uploadAttachment(kind, id, file, options);
    get().upsertFromRemote(attachment);
    return attachment;
  },

  removeAttachment: async (attachmentId, kind, ownerId) => {
    await deleteAttachment(attachmentId);
    // The owner key is captured here so the store can update optimistically
    // even if the server's `attachment_removed` broadcast hasn't arrived yet.
    get().removeFromRemote(kind, ownerId, attachmentId);
  },

  renameAttachment: async (attachmentId, name) => {
    const updated = await updateAttachment(attachmentId, { name });
    get().upsertFromRemote(updated);
    return updated;
  },

  reorderAttachments: async (kind, ownerId, orderedIds) => {
    const key = ownerKey(kind, ownerId);
    const existing = get().byOwner[key];
    if (!existing) return;

    // Build the new list from existing rows in the requested order. Anything
    // not in `orderedIds` (e.g. concurrent additions) keeps its original
    // position at the tail.
    const byId = new Map(existing.map((a) => [a.id, a]));
    const reordered: Attachment[] = [];
    for (let i = 0; i < orderedIds.length; i++) {
      const a = byId.get(orderedIds[i]);
      if (!a) continue;
      reordered.push({ ...a, sortOrder: i });
      byId.delete(orderedIds[i]);
    }
    // Remaining rows keep their relative order, appended after the moved set.
    let tailIndex = reordered.length;
    for (const a of existing) {
      if (byId.has(a.id)) {
        reordered.push({ ...a, sortOrder: tailIndex++ });
      }
    }

    set((state) => ({ byOwner: { ...state.byOwner, [key]: reordered } }));

    // Persist concurrently. If any fails we surface it; the server's eventual
    // broadcast will fix any divergence.
    await Promise.all(
      reordered.map((a, i) =>
        updateAttachment(a.id, { sortOrder: i }).catch((err) => {
          console.error('[attachments] reorder PATCH failed for', a.id, err);
          throw err;
        }),
      ),
    );
  },

  upsertFromRemote: (attachment) => {
    const key = ownerKey(attachment.ownerKind, attachment.ownerId);
    set((state) => {
      const existing = state.byOwner[key];
      // Owner already fully loaded — update the array. Count is derived.
      if (existing) {
        const idx = existing.findIndex((a) => a.id === attachment.id);
        const next = idx >= 0
          ? existing.map((a, i) => (i === idx ? attachment : a))
          : [...existing, attachment];
        return { byOwner: { ...state.byOwner, [key]: sortAttachments(next) } };
      }
      // Owner only has a count cached — bump it. We deliberately don't
      // populate `byOwner` here to avoid showing partial lists.
      if (key in state.countsByOwner) {
        return {
          countsByOwner: { ...state.countsByOwner, [key]: state.countsByOwner[key] + 1 },
        };
      }
      // Owner unknown — start a count of 1 so the badge reflects the new
      // attachment as soon as the broadcast arrives.
      return {
        countsByOwner: { ...state.countsByOwner, [key]: 1 },
      };
    });
  },

  removeFromRemote: (kind, ownerId, id) => {
    const key = ownerKey(kind, ownerId);
    set((state) => {
      const existing = state.byOwner[key];
      if (existing) {
        return {
          byOwner: { ...state.byOwner, [key]: existing.filter((a) => a.id !== id) },
        };
      }
      if (key in state.countsByOwner) {
        const next = Math.max(0, state.countsByOwner[key] - 1);
        return { countsByOwner: { ...state.countsByOwner, [key]: next } };
      }
      return state;
    });
  },

  getCount: (kind, id) => {
    const key = ownerKey(kind, id);
    const state = get();
    if (key in state.byOwner) return state.byOwner[key].length;
    return state.countsByOwner[key] ?? 0;
  },

  __reset: () => set({ byOwner: {}, countsByOwner: {}, loadingOwners: {} }),
}));
