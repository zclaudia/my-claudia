import { useCallback, useEffect, useMemo } from 'react';
import type { Attachment, AttachmentOwnerKind } from '@my-claudia/shared';
import { useAttachmentsStore, ownerKey } from '../store';
import type { UploadAttachmentOptions } from '../api';

export interface UseAttachmentsResult {
  items: Attachment[];
  isLoading: boolean;
  reload: () => Promise<Attachment[]>;
  upload: (file: File, options?: UploadAttachmentOptions) => Promise<Attachment>;
  remove: (id: string) => Promise<void>;
  rename: (id: string, name: string) => Promise<Attachment>;
}

/**
 * React hook giving a feature module CRUD access to the attachments belonging
 * to a single (ownerKind, ownerId) pair. Lazily loads on mount.
 */
export function useAttachments(
  ownerKind: AttachmentOwnerKind | null | undefined,
  ownerId: string | null | undefined,
): UseAttachmentsResult {
  const safeKind = ownerKind ?? null;
  const safeId = ownerId ?? null;
  const key = safeKind && safeId ? ownerKey(safeKind, safeId) : '';

  const items = useAttachmentsStore((state) => (key ? state.byOwner[key] : undefined)) ?? EMPTY;
  const isLoading = useAttachmentsStore((state) => (key ? !!state.loadingOwners[key] : false));

  const loadAttachments = useAttachmentsStore((state) => state.loadAttachments);
  const uploadFn = useAttachmentsStore((state) => state.uploadAttachment);
  const removeFn = useAttachmentsStore((state) => state.removeAttachment);
  const renameFn = useAttachmentsStore((state) => state.renameAttachment);

  useEffect(() => {
    if (!safeKind || !safeId) return;
    loadAttachments(safeKind, safeId).catch(() => {
      /* swallow — surfaced via state if needed in v2 */
    });
  }, [safeKind, safeId, loadAttachments]);

  const reload = useCallback(async () => {
    if (!safeKind || !safeId) return [];
    return loadAttachments(safeKind, safeId);
  }, [safeKind, safeId, loadAttachments]);

  const upload = useCallback(
    async (file: File, options?: UploadAttachmentOptions) => {
      if (!safeKind || !safeId) {
        throw new Error('useAttachments: ownerKind/ownerId required to upload');
      }
      return uploadFn(safeKind, safeId, file, options);
    },
    [safeKind, safeId, uploadFn],
  );

  const remove = useCallback(
    async (id: string) => {
      if (!safeKind || !safeId) return;
      await removeFn(id, safeKind, safeId);
    },
    [safeKind, safeId, removeFn],
  );

  const rename = useCallback(
    async (id: string, name: string) => {
      if (!safeKind || !safeId) {
        throw new Error('useAttachments: ownerKind/ownerId required to rename');
      }
      return renameFn(id, name);
    },
    [safeKind, safeId, renameFn],
  );

  return useMemo(
    () => ({ items, isLoading, reload, upload, remove, rename }),
    [items, isLoading, reload, upload, remove, rename],
  );
}

const EMPTY: Attachment[] = [];
