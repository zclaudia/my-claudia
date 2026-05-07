import type { AttachmentKind, AttachmentOwnerKind } from '@my-claudia/shared/features/attachment';

const KNOWN_OWNER_KINDS: ReadonlySet<AttachmentOwnerKind> = new Set([
  'local_issue',
  'comment',
  'local_pr',
  'note',
  'session_message',
]);

/**
 * Map a MIME type to a coarse-grained AttachmentKind. Returns 'file' as a
 * conservative fallback so unknown payloads still get stored, just rendered
 * as generic files in the UI.
 */
export function detectKindFromMime(mimeType: string): AttachmentKind {
  const mime = (mimeType || '').toLowerCase();
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';

  if (
    mime === 'application/pdf' ||
    mime === 'application/msword' ||
    mime === 'application/vnd.ms-excel' ||
    mime === 'application/vnd.ms-powerpoint' ||
    mime.startsWith('application/vnd.openxmlformats-officedocument.') ||
    mime.startsWith('text/')
  ) {
    return 'document';
  }
  return 'file';
}

export function isValidOwnerKind(value: unknown): value is AttachmentOwnerKind {
  return typeof value === 'string' && KNOWN_OWNER_KINDS.has(value as AttachmentOwnerKind);
}
