import type { Database } from 'better-sqlite3';
import type {
  Attachment,
  AttachmentOwnerKind,
} from '@my-claudia/shared/features/attachment';
import type {
  AttachmentAddedMessage,
  AttachmentRemovedMessage,
  ServerMessage,
} from '@my-claudia/shared/protocol/messages';
import {
  attachmentStore,
  type AttachmentStore,
} from '../../infrastructure/storage/attachmentStore.js';
import { AttachmentRepository, type AttachmentRow } from './repository.js';
import { detectKindFromMime } from './kind-detector.js';

export type AttachmentBroadcaster = (message: ServerMessage) => void;

export interface AttachmentInputCommon {
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  name: string;
  mimeType: string;
  createdBy?: string;
  sortOrder?: number;
}

export interface AddFromTempFileInput extends AttachmentInputCommon {
  tempPath: string; // multer disk-storage temp path; will be moved into the store
}

export interface AddFromBufferInput extends AttachmentInputCommon {
  buffer: Buffer;
}

export class AttachmentService {
  private repo: AttachmentRepository;
  private store: AttachmentStore;

  constructor(
    db: Database,
    private broadcast: AttachmentBroadcaster,
    storeOverride?: AttachmentStore,
  ) {
    this.repo = new AttachmentRepository(db);
    this.store = (storeOverride ?? attachmentStore) as AttachmentStore;
  }

  getRepo(): AttachmentRepository {
    return this.repo;
  }

  /**
   * Add an attachment whose bytes already live on disk (e.g. a multer temp
   * file). The source file is moved into the store — caller does NOT need to
   * remove it afterwards.
   */
  addFromTempFile(input: AddFromTempFileInput): Attachment {
    const meta = this.store.storeByMoving(input.tempPath);
    return this.persistAndBroadcast({
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      name: input.name,
      mimeType: input.mimeType,
      createdBy: input.createdBy,
      sortOrder: input.sortOrder,
      size: meta.size,
      sha256: meta.sha256,
      storageKey: meta.storageKey,
    });
  }

  /**
   * Add an attachment from an in-memory Buffer (used by JSON/base64 upload
   * path).
   */
  addFromBuffer(input: AddFromBufferInput): Attachment {
    const meta = this.store.storeFromBuffer(input.buffer);
    return this.persistAndBroadcast({
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      name: input.name,
      mimeType: input.mimeType,
      createdBy: input.createdBy,
      sortOrder: input.sortOrder,
      size: meta.size,
      sha256: meta.sha256,
      storageKey: meta.storageKey,
    });
  }

  list(ownerKind: AttachmentOwnerKind, ownerId: string): Attachment[] {
    return this.repo.findByOwner(ownerKind, ownerId).map(toAttachment);
  }

  countByOwners(
    ownerKind: AttachmentOwnerKind,
    ownerIds: string[],
  ): Map<string, number> {
    return this.repo.countByOwners(ownerKind, ownerIds);
  }

  findById(id: string): AttachmentRow | null {
    return this.repo.findById(id);
  }

  update(id: string, patch: { name?: string; sortOrder?: number }): Attachment {
    const updated = this.repo.update(id, patch);
    const att = toAttachment(updated);
    this.broadcast({
      type: 'attachment_added',
      ownerKind: att.ownerKind,
      ownerId: att.ownerId,
      attachment: att,
    } as AttachmentAddedMessage);
    return att;
  }

  /**
   * Remove a single attachment (DB row first, then disk). Returns the deleted
   * row's owner pair so callers can react. If the attachment doesn't exist,
   * returns null.
   */
  remove(id: string): { ownerKind: AttachmentOwnerKind; ownerId: string } | null {
    const row = this.repo.findById(id);
    if (!row) return null;
    this.repo.delete(id);
    this.store.delete(row.storageKey);
    this.broadcast({
      type: 'attachment_removed',
      ownerKind: row.ownerKind,
      ownerId: row.ownerId,
      attachmentId: id,
    } as AttachmentRemovedMessage);
    return { ownerKind: row.ownerKind, ownerId: row.ownerId };
  }

  /**
   * Cascade-delete every attachment that belongs to the given owner. Used by
   * consuming domains right before they delete the owner row themselves.
   * Broadcasts one `attachment_removed` per row.
   */
  deleteByOwner(ownerKind: AttachmentOwnerKind, ownerId: string): number {
    const rows = this.repo.deleteByOwner(ownerKind, ownerId);
    for (const row of rows) {
      this.store.delete(row.storageKey);
      this.broadcast({
        type: 'attachment_removed',
        ownerKind: row.ownerKind,
        ownerId: row.ownerId,
        attachmentId: row.id,
      } as AttachmentRemovedMessage);
    }
    return rows.length;
  }

  // ── internals ──────────────────────────────────────────────────────

  private persistAndBroadcast(input: {
    ownerKind: AttachmentOwnerKind;
    ownerId: string;
    name: string;
    mimeType: string;
    createdBy?: string;
    sortOrder?: number;
    size: number;
    sha256: string;
    storageKey: string;
  }): Attachment {
    const kind = detectKindFromMime(input.mimeType);
    const row = this.repo.create({
      ownerKind: input.ownerKind,
      ownerId: input.ownerId,
      storageKey: input.storageKey,
      name: input.name,
      mimeType: input.mimeType,
      size: input.size,
      kind,
      sha256: input.sha256,
      createdBy: input.createdBy,
      sortOrder: input.sortOrder ?? 0,
    });
    const attachment = toAttachment(row);
    this.broadcast({
      type: 'attachment_added',
      ownerKind: attachment.ownerKind,
      ownerId: attachment.ownerId,
      attachment,
    } as AttachmentAddedMessage);
    return attachment;
  }
}

export function toAttachment(row: AttachmentRow): Attachment {
  return {
    id: row.id,
    ownerKind: row.ownerKind,
    ownerId: row.ownerId,
    name: row.name,
    mimeType: row.mimeType,
    size: row.size,
    kind: row.kind,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    createdBy: row.createdBy,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt,
  };
}
