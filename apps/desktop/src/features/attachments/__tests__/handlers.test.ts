import { describe, it, expect, beforeEach } from 'vitest';
import type { Attachment } from '@my-claudia/shared';
import { handleAttachmentMessage } from '../handlers';
import { useAttachmentsStore } from '../store';

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
});

describe('attachment message handler', () => {
  it('routes attachment_added into the store and bumps the count', () => {
    const handled = handleAttachmentMessage({
      type: 'attachment_added',
      attachment: att(),
    } as any);

    expect(handled).toBe(true);
    // Owner wasn't loaded — only the count is updated, byOwner stays untouched
    // to avoid presenting partial data.
    expect(useAttachmentsStore.getState().getCount('local_issue', 'issue-1')).toBe(1);
    expect(useAttachmentsStore.getState().byOwner['local_issue:issue-1']).toBeUndefined();
  });

  it('routes attachment_removed into the store and decrements the count', () => {
    useAttachmentsStore.getState().upsertFromRemote(att());
    expect(useAttachmentsStore.getState().getCount('local_issue', 'issue-1')).toBe(1);

    const handled = handleAttachmentMessage({
      type: 'attachment_removed',
      ownerKind: 'local_issue',
      ownerId: 'issue-1',
      attachmentId: 'a1',
    } as any);

    expect(handled).toBe(true);
    expect(useAttachmentsStore.getState().getCount('local_issue', 'issue-1')).toBe(0);
  });

  it('returns false for unrelated messages', () => {
    const handled = handleAttachmentMessage({ type: 'something_else' } as any);
    expect(handled).toBe(false);
  });
});
