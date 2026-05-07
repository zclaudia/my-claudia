// Attachment Types
//
// Generic, polymorphic attachment system. Any business entity (local issue,
// PR, comment, note, ...) can attach binaries by referencing an Attachment via
// (ownerKind, ownerId). Storage and lifecycle are independent from the
// conversation-scoped `files` table — see fileStore vs attachmentStore.

export type AttachmentOwnerKind =
  | 'local_issue'
  | 'comment'
  | 'local_pr'
  | 'note'
  | 'session_message';

export type AttachmentKind = 'image' | 'video' | 'audio' | 'document' | 'file';

export interface Attachment {
  id: string;
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  width?: number;
  height?: number;
  sha256?: string;
  createdBy?: string;
  sortOrder: number;
  createdAt: number;
}

export interface AttachmentInput {
  name: string;
  mimeType: string;
  size: number;
}

export interface AttachmentCount {
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  count: number;
}
