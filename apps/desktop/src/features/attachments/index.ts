export {
  listAttachments,
  listAttachmentCounts,
  uploadAttachment,
  deleteAttachment,
  updateAttachment,
  fetchAttachmentBlobUrl,
  downloadAttachment,
  type UploadAttachmentOptions,
} from './api';

export { useAttachmentsStore, ownerKey } from './store';
export { handleAttachmentMessage } from './handlers';

export { useAttachments } from './hooks/useAttachments';
export type { UseAttachmentsResult } from './hooks/useAttachments';
export { useAttachmentSrc } from './hooks/useAttachmentSrc';
export type { UseAttachmentSrcResult } from './hooks/useAttachmentSrc';
export { useAttachmentCount, useAttachmentCounts } from './hooks/useAttachmentCounts';

export { AttachmentDropZone } from './components/AttachmentDropZone';
export { AttachmentPicker } from './components/AttachmentPicker';
export { AttachmentList } from './components/AttachmentList';
export { AttachmentThumbnail } from './components/AttachmentThumbnail';
export { SortableAttachmentThumbnail } from './components/SortableAttachmentThumbnail';
export { ImageLightbox } from './components/ImageLightbox';

export { formatFileSize, attachmentKindFromMime, filesFromDataTransfer } from './utils';
