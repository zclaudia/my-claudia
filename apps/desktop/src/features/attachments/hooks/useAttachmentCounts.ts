import { useEffect, useMemo, useRef } from 'react';
import type { AttachmentOwnerKind } from '@my-claudia/shared';
import { useAttachmentsStore, ownerKey } from '../store';

/**
 * Subscribe to a single attachment count from the store. Combines `byOwner`
 * (full lists) and `countsByOwner` (lightweight counts) — whichever has
 * authoritative data wins. Does NOT trigger any network call; counts arrive
 * via realtime events or batched `useAttachmentCounts` loads.
 */
export function useAttachmentCount(
  kind: AttachmentOwnerKind | null | undefined,
  id: string | null | undefined,
): number {
  const key = kind && id ? ownerKey(kind, id) : '';
  return useAttachmentsStore((state) => {
    if (!key) return 0;
    const list = state.byOwner[key];
    if (list) return list.length;
    return state.countsByOwner[key] ?? 0;
  });
}

/**
 * Batched count fetcher — issues a single `/api/attachments/counts` request
 * for `ids` whose counts we don't already know. Re-fires only when the
 * id-set actually changes. Stores results in the global `countsByOwner`,
 * which child components subscribe to via `useAttachmentCount`.
 *
 * Returns nothing on purpose: callers should use `useAttachmentCount(kind,id)`
 * inside the row component so that only that row re-renders when its count
 * changes.
 */
export function useAttachmentCounts(
  kind: AttachmentOwnerKind | null | undefined,
  ids: string[],
): void {
  const loadCounts = useAttachmentsStore((s) => s.loadAttachmentCounts);

  // Sorted-and-joined signature so identical id sets in different orders
  // don't trigger redundant requests.
  const signature = useMemo(() => [...ids].sort().join(','), [ids]);
  const lastSignature = useRef<string | null>(null);

  useEffect(() => {
    if (!kind || ids.length === 0) return;
    if (lastSignature.current === signature) return;
    lastSignature.current = signature;
    loadCounts(kind, ids).catch(() => {
      /* swallow — UI falls back to per-card lazy loads */
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, signature]);
}
