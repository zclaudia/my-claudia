import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

vi.mock('../api', () => ({
  listAttachments: vi.fn(),
  listAttachmentCounts: vi.fn(),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  updateAttachment: vi.fn(),
}));

import { useAttachmentsStore } from '../store';
import { listAttachmentCounts } from '../api';
import { useAttachmentCount, useAttachmentCounts } from '../hooks/useAttachmentCounts';

beforeEach(() => {
  useAttachmentsStore.getState().__reset();
  vi.clearAllMocks();
});

describe('useAttachmentCount', () => {
  it('returns 0 for unknown owner', () => {
    const { result } = renderHook(() => useAttachmentCount('local_issue', 'unknown'));
    expect(result.current).toBe(0);
  });

  it('reflects standalone count and reactively updates', async () => {
    (listAttachmentCounts as any).mockResolvedValue([
      { ownerKind: 'local_issue', ownerId: 'iss-1', count: 4 },
    ]);
    await useAttachmentsStore.getState().loadAttachmentCounts('local_issue', ['iss-1']);

    const { result } = renderHook(() => useAttachmentCount('local_issue', 'iss-1'));
    expect(result.current).toBe(4);

    await act(async () => {
      useAttachmentsStore.getState().upsertFromRemote({
        id: 'a-new',
        ownerKind: 'local_issue',
        ownerId: 'iss-1',
        name: 'x.png',
        mimeType: 'image/png',
        size: 1,
        kind: 'image',
        sortOrder: 0,
        createdAt: 0,
      });
    });
    expect(result.current).toBe(5);
  });

  it('returns 0 when kind/id is null', () => {
    const { result } = renderHook(() => useAttachmentCount(null, null));
    expect(result.current).toBe(0);
  });
});

describe('useAttachmentCounts', () => {
  it('issues one batch call for the supplied ids', async () => {
    (listAttachmentCounts as any).mockResolvedValue([
      { ownerKind: 'local_issue', ownerId: 'a', count: 1 },
    ]);
    renderHook(() => useAttachmentCounts('local_issue', ['a', 'b']));

    await vi.waitFor(() => expect(listAttachmentCounts).toHaveBeenCalledTimes(1));
    expect((listAttachmentCounts as any).mock.calls[0][1]).toEqual(['a', 'b']);
  });

  it('does not refire when id list re-renders in different order', async () => {
    (listAttachmentCounts as any).mockResolvedValue([]);
    const { rerender } = renderHook(({ ids }) => useAttachmentCounts('local_issue', ids), {
      initialProps: { ids: ['a', 'b', 'c'] },
    });
    await vi.waitFor(() => expect(listAttachmentCounts).toHaveBeenCalledTimes(1));

    rerender({ ids: ['c', 'b', 'a'] });
    rerender({ ids: ['b', 'a', 'c'] });

    expect(listAttachmentCounts).toHaveBeenCalledTimes(1);
  });

  it('refires when the id set actually changes', async () => {
    (listAttachmentCounts as any).mockResolvedValue([]);
    const { rerender } = renderHook(({ ids }) => useAttachmentCounts('local_issue', ids), {
      initialProps: { ids: ['a'] },
    });
    await vi.waitFor(() => expect(listAttachmentCounts).toHaveBeenCalledTimes(1));

    rerender({ ids: ['a', 'b'] });
    await vi.waitFor(() => expect(listAttachmentCounts).toHaveBeenCalledTimes(2));
  });

  it('skips fetching for empty id list', async () => {
    renderHook(() => useAttachmentCounts('local_issue', []));
    // give the effect a chance to run
    await new Promise((r) => setTimeout(r, 0));
    expect(listAttachmentCounts).not.toHaveBeenCalled();
  });
});
