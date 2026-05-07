import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Attachment } from '@my-claudia/shared';

vi.mock('../api', () => ({
  listAttachments: vi.fn(),
  listAttachmentCounts: vi.fn(),
  uploadAttachment: vi.fn(),
  deleteAttachment: vi.fn(),
  updateAttachment: vi.fn(),
}));

import { useAttachmentsStore, ownerKey } from '../store';
import {
  listAttachments,
  listAttachmentCounts,
  uploadAttachment,
  deleteAttachment,
  updateAttachment,
} from '../api';

const att = (overrides: Partial<Attachment> = {}): Attachment => ({
  id: 'a1',
  ownerKind: 'local_issue',
  ownerId: 'issue-1',
  name: 'pic.png',
  mimeType: 'image/png',
  size: 1234,
  kind: 'image',
  sortOrder: 0,
  createdAt: 1000,
  ...overrides,
});

beforeEach(() => {
  useAttachmentsStore.getState().__reset();
  vi.clearAllMocks();
});

describe('attachments store', () => {
  it('ownerKey concatenates kind and id', () => {
    expect(ownerKey('local_issue', 'iss-9')).toBe('local_issue:iss-9');
  });

  it('loadAttachments populates byOwner sorted', async () => {
    (listAttachments as any).mockResolvedValue([
      att({ id: 'b', sortOrder: 5, createdAt: 100 }),
      att({ id: 'a', sortOrder: 1, createdAt: 200 }),
      att({ id: 'c', sortOrder: 1, createdAt: 50 }),
    ]);

    const result = await useAttachmentsStore
      .getState()
      .loadAttachments('local_issue', 'issue-1');

    expect(result.map((a) => a.id)).toEqual(['c', 'a', 'b']);
    expect(useAttachmentsStore.getState().byOwner['local_issue:issue-1'].map((a) => a.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('loadAttachments deduplicates concurrent calls', async () => {
    let resolveFn: ((value: Attachment[]) => void) = () => {};
    (listAttachments as any).mockReturnValue(
      new Promise<Attachment[]>((resolve) => {
        resolveFn = resolve;
      }),
    );

    const p1 = useAttachmentsStore.getState().loadAttachments('local_issue', 'issue-1');
    const p2 = useAttachmentsStore.getState().loadAttachments('local_issue', 'issue-1');

    expect((listAttachments as any).mock.calls.length).toBe(1);
    resolveFn([att({ id: 'a' })]);
    await Promise.all([p1, p2]);
    expect(useAttachmentsStore.getState().byOwner['local_issue:issue-1']).toHaveLength(1);
  });

  it('loadAttachments resets loading flag on error', async () => {
    (listAttachments as any).mockRejectedValue(new Error('boom'));

    await expect(
      useAttachmentsStore.getState().loadAttachments('local_issue', 'issue-1'),
    ).rejects.toThrow('boom');
    expect(useAttachmentsStore.getState().loadingOwners['local_issue:issue-1']).toBe(false);
  });

  // Helper: prime byOwner so subsequent realtime events behave as "owner is
  // fully loaded". Mirrors the production flow (panel calls loadAttachments
  // before showing any list).
  async function primeOwner(initial: Attachment[] = []) {
    (listAttachments as any).mockResolvedValue(initial);
    await useAttachmentsStore.getState().loadAttachments('local_issue', 'issue-1');
    (listAttachments as any).mockReset();
  }

  it('upsertFromRemote inserts new and updates existing', async () => {
    await primeOwner();
    const a = att({ id: 'a', sortOrder: 1 });
    const b = att({ id: 'b', sortOrder: 2 });

    useAttachmentsStore.getState().upsertFromRemote(a);
    useAttachmentsStore.getState().upsertFromRemote(b);
    expect(useAttachmentsStore.getState().byOwner['local_issue:issue-1']).toHaveLength(2);

    useAttachmentsStore.getState().upsertFromRemote({ ...a, name: 'renamed.png' });
    const list = useAttachmentsStore.getState().byOwner['local_issue:issue-1'];
    expect(list.find((x) => x.id === 'a')?.name).toBe('renamed.png');
    expect(list).toHaveLength(2);
  });

  it('removeFromRemote drops by id, no-op when key missing', async () => {
    await primeOwner([att({ id: 'a' }), att({ id: 'b' })]);
    useAttachmentsStore.getState().removeFromRemote('local_issue', 'issue-1', 'a');
    expect(
      useAttachmentsStore.getState().byOwner['local_issue:issue-1'].map((x) => x.id),
    ).toEqual(['b']);

    expect(() =>
      useAttachmentsStore.getState().removeFromRemote('local_issue', 'no-owner', 'b'),
    ).not.toThrow();
  });

  it('uploadAttachment delegates to api and inserts', async () => {
    await primeOwner();
    const created = att({ id: 'newly-uploaded' });
    (uploadAttachment as any).mockResolvedValue(created);

    const result = await useAttachmentsStore
      .getState()
      .uploadAttachment('local_issue', 'issue-1', new File(['x'], 'x.png'));

    expect(uploadAttachment).toHaveBeenCalledWith(
      'local_issue',
      'issue-1',
      expect.any(File),
      undefined,
    );
    expect(result).toEqual(created);
    expect(useAttachmentsStore.getState().byOwner['local_issue:issue-1']).toHaveLength(1);
  });

  it('removeAttachment calls api and updates store optimistically', async () => {
    await primeOwner([att({ id: 'a' })]);
    (deleteAttachment as any).mockResolvedValue(undefined);

    await useAttachmentsStore.getState().removeAttachment('a', 'local_issue', 'issue-1');

    expect(deleteAttachment).toHaveBeenCalledWith('a');
    expect(useAttachmentsStore.getState().byOwner['local_issue:issue-1']).toHaveLength(0);
  });

  it('renameAttachment patches and updates entry in place', async () => {
    await primeOwner([att({ id: 'a', name: 'old.png' })]);
    (updateAttachment as any).mockResolvedValue({ ...att({ id: 'a' }), name: 'new.png' });

    await useAttachmentsStore.getState().renameAttachment('a', 'new.png');

    expect(updateAttachment).toHaveBeenCalledWith('a', { name: 'new.png' });
    expect(
      useAttachmentsStore.getState().byOwner['local_issue:issue-1'].find((x) => x.id === 'a')
        ?.name,
    ).toBe('new.png');
  });

  it('reorderAttachments rewrites sortOrder and PATCHes every item', async () => {
    await primeOwner([
      att({ id: 'a', sortOrder: 0 }),
      att({ id: 'b', sortOrder: 1 }),
      att({ id: 'c', sortOrder: 2 }),
    ]);
    (updateAttachment as any).mockImplementation((id: string, patch: { sortOrder?: number }) =>
      Promise.resolve(att({ id, sortOrder: patch.sortOrder ?? 0 })),
    );

    await useAttachmentsStore
      .getState()
      .reorderAttachments('local_issue', 'issue-1', ['c', 'a', 'b']);

    const list = useAttachmentsStore.getState().byOwner['local_issue:issue-1'];
    expect(list.map((x) => x.id)).toEqual(['c', 'a', 'b']);
    expect(list.map((x) => x.sortOrder)).toEqual([0, 1, 2]);

    expect(updateAttachment).toHaveBeenCalledTimes(3);
    expect(updateAttachment).toHaveBeenCalledWith('c', { sortOrder: 0 });
    expect(updateAttachment).toHaveBeenCalledWith('a', { sortOrder: 1 });
    expect(updateAttachment).toHaveBeenCalledWith('b', { sortOrder: 2 });
  });

  it('reorderAttachments tolerates partial id lists (concurrent additions kept at tail)', async () => {
    await primeOwner([
      att({ id: 'a', sortOrder: 0 }),
      att({ id: 'b', sortOrder: 1 }),
      att({ id: 'c', sortOrder: 2 }),
    ]);
    (updateAttachment as any).mockResolvedValue(att({ id: 'x' }));

    // Caller only knows about a/b — c was added concurrently and should keep
    // its relative position at the tail rather than being dropped.
    await useAttachmentsStore
      .getState()
      .reorderAttachments('local_issue', 'issue-1', ['b', 'a']);

    const list = useAttachmentsStore.getState().byOwner['local_issue:issue-1'];
    expect(list.map((x) => x.id)).toEqual(['b', 'a', 'c']);
  });

  it('reorderAttachments is a no-op when owner not loaded', async () => {
    await useAttachmentsStore
      .getState()
      .reorderAttachments('local_issue', 'unknown-issue', ['a', 'b']);
    expect(updateAttachment).not.toHaveBeenCalled();
  });
});

describe('attachments store - counts', () => {
  beforeEach(() => {
    useAttachmentsStore.getState().__reset();
    vi.clearAllMocks();
  });

  it('loadAttachmentCounts populates countsByOwner including 0s for missing owners', async () => {
    (listAttachmentCounts as any).mockResolvedValue([
      { ownerKind: 'local_issue', ownerId: 'a', count: 3 },
      { ownerKind: 'local_issue', ownerId: 'c', count: 1 },
    ]);

    await useAttachmentsStore.getState().loadAttachmentCounts('local_issue', ['a', 'b', 'c']);

    expect(useAttachmentsStore.getState().getCount('local_issue', 'a')).toBe(3);
    expect(useAttachmentsStore.getState().getCount('local_issue', 'b')).toBe(0);
    expect(useAttachmentsStore.getState().getCount('local_issue', 'c')).toBe(1);
  });

  it('loadAttachmentCounts skips owners with cached lists (byOwner.length wins)', async () => {
    (listAttachments as any).mockResolvedValue([
      att({ id: 'a', ownerId: 'iss-1' }),
      att({ id: 'b', ownerId: 'iss-1' }),
    ]);
    await useAttachmentsStore.getState().loadAttachments('local_issue', 'iss-1');

    (listAttachmentCounts as any).mockResolvedValue([
      { ownerKind: 'local_issue', ownerId: 'iss-2', count: 5 },
    ]);

    await useAttachmentsStore
      .getState()
      .loadAttachmentCounts('local_issue', ['iss-1', 'iss-2']);

    // iss-1 was excluded from the request body.
    expect((listAttachmentCounts as any).mock.calls[0][1]).toEqual(['iss-2']);
    expect(useAttachmentsStore.getState().getCount('local_issue', 'iss-1')).toBe(2);
    expect(useAttachmentsStore.getState().getCount('local_issue', 'iss-2')).toBe(5);
  });

  it('loadAttachmentCounts is a no-op for empty id list', async () => {
    await useAttachmentsStore.getState().loadAttachmentCounts('local_issue', []);
    expect(listAttachmentCounts).not.toHaveBeenCalled();
  });

  it('loadAttachments drops the standalone count once full list arrives', async () => {
    (listAttachmentCounts as any).mockResolvedValue([
      { ownerKind: 'local_issue', ownerId: 'iss-1', count: 7 },
    ]);
    await useAttachmentsStore.getState().loadAttachmentCounts('local_issue', ['iss-1']);
    expect(useAttachmentsStore.getState().countsByOwner['local_issue:iss-1']).toBe(7);

    (listAttachments as any).mockResolvedValue([att({ id: 'a' })]);
    await useAttachmentsStore.getState().loadAttachments('local_issue', 'iss-1');

    expect('local_issue:iss-1' in useAttachmentsStore.getState().countsByOwner).toBe(false);
    expect(useAttachmentsStore.getState().getCount('local_issue', 'iss-1')).toBe(1);
  });

  it('upsertFromRemote increments standalone count when full list not loaded', async () => {
    (listAttachmentCounts as any).mockResolvedValue([
      { ownerKind: 'local_issue', ownerId: 'iss-9', count: 2 },
    ]);
    await useAttachmentsStore.getState().loadAttachmentCounts('local_issue', ['iss-9']);

    useAttachmentsStore
      .getState()
      .upsertFromRemote(att({ id: 'new', ownerId: 'iss-9' }));

    expect(useAttachmentsStore.getState().getCount('local_issue', 'iss-9')).toBe(3);
    // byOwner intentionally not populated — partial list would be misleading.
    expect(useAttachmentsStore.getState().byOwner['local_issue:iss-9']).toBeUndefined();
  });

  it('upsertFromRemote starts a fresh count for an unknown owner', () => {
    useAttachmentsStore
      .getState()
      .upsertFromRemote(att({ id: 'a', ownerId: 'iss-new' }));

    expect(useAttachmentsStore.getState().getCount('local_issue', 'iss-new')).toBe(1);
  });

  it('removeFromRemote decrements standalone count and floors at 0', async () => {
    (listAttachmentCounts as any).mockResolvedValue([
      { ownerKind: 'local_issue', ownerId: 'iss-x', count: 1 },
    ]);
    await useAttachmentsStore.getState().loadAttachmentCounts('local_issue', ['iss-x']);

    useAttachmentsStore.getState().removeFromRemote('local_issue', 'iss-x', 'whatever');
    expect(useAttachmentsStore.getState().getCount('local_issue', 'iss-x')).toBe(0);

    useAttachmentsStore.getState().removeFromRemote('local_issue', 'iss-x', 'whatever');
    expect(useAttachmentsStore.getState().getCount('local_issue', 'iss-x')).toBe(0);
  });
});
