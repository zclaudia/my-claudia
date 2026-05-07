import type { AttachmentKind } from '@my-claudia/shared';

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function attachmentKindFromMime(mime: string | undefined): AttachmentKind {
  const m = (mime || '').toLowerCase();
  if (m.startsWith('image/')) return 'image';
  if (m.startsWith('video/')) return 'video';
  if (m.startsWith('audio/')) return 'audio';
  if (
    m === 'application/pdf' ||
    m === 'application/msword' ||
    m === 'application/vnd.ms-excel' ||
    m === 'application/vnd.ms-powerpoint' ||
    m.startsWith('application/vnd.openxmlformats-officedocument.') ||
    m.startsWith('text/')
  ) {
    return 'document';
  }
  return 'file';
}

/**
 * Read items off a clipboard / drag event and return only the File entries
 * (filters out folders and non-file items).
 */
export function filesFromDataTransfer(items: DataTransferItemList | null | undefined): File[] {
  if (!items) return [];
  const files: File[] = [];
  for (const item of Array.from(items)) {
    if (item.kind !== 'file') continue;
    const file = item.getAsFile();
    if (file) files.push(file);
  }
  return files;
}
