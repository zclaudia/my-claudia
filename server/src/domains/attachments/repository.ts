import type { Database } from 'better-sqlite3';
import type {
  AttachmentKind,
  AttachmentOwnerKind,
} from '@my-claudia/shared/features/attachment';
import { v4 as uuidv4 } from 'uuid';
import { BaseRepository } from '../../infrastructure/repositories/base.js';

export interface AttachmentRow {
  id: string;
  ownerKind: AttachmentOwnerKind;
  ownerId: string;
  storageKey: string;
  name: string;
  mimeType: string;
  size: number;
  kind: AttachmentKind;
  sha256?: string;
  width?: number;
  height?: number;
  createdBy?: string;
  sortOrder: number;
  createdAt: number;
}

export type AttachmentCreateInput = Omit<AttachmentRow, 'id' | 'createdAt'> & {
  id?: string;
  createdAt?: number;
};

export type AttachmentUpdateInput = Partial<{
  name: string;
  sortOrder: number;
}>;

export class AttachmentRepository extends BaseRepository<
  AttachmentRow,
  AttachmentCreateInput,
  AttachmentUpdateInput
> {
  constructor(db: Database) {
    super(db, 'attachments');
  }

  mapRow(raw: unknown): AttachmentRow {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      ownerKind: row.owner_kind as AttachmentOwnerKind,
      ownerId: row.owner_id as string,
      storageKey: row.storage_key as string,
      name: row.name as string,
      mimeType: row.mime_type as string,
      size: row.size as number,
      kind: row.kind as AttachmentKind,
      sha256: (row.sha256 as string) || undefined,
      width: (row.width as number) ?? undefined,
      height: (row.height as number) ?? undefined,
      createdBy: (row.created_by as string) || undefined,
      sortOrder: (row.sort_order as number) ?? 0,
      createdAt: row.created_at as number,
    };
  }

  createQuery(data: AttachmentCreateInput): { sql: string; params: unknown[] } {
    const id = data.id ?? uuidv4();
    const createdAt = data.createdAt ?? Date.now();
    return {
      sql: `INSERT INTO attachments (
        id, owner_kind, owner_id, storage_key, name, mime_type, size, kind,
        sha256, width, height, created_by, sort_order, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id,
        data.ownerKind,
        data.ownerId,
        data.storageKey,
        data.name,
        data.mimeType,
        data.size,
        data.kind,
        data.sha256 ?? null,
        data.width ?? null,
        data.height ?? null,
        data.createdBy ?? null,
        data.sortOrder ?? 0,
        createdAt,
      ],
    };
  }

  updateQuery(id: string, data: AttachmentUpdateInput): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.name !== undefined) {
      sets.push('name = ?');
      params.push(data.name);
    }
    if (data.sortOrder !== undefined) {
      sets.push('sort_order = ?');
      params.push(data.sortOrder);
    }
    if (sets.length === 0) {
      // No-op update — keep DB consistent by touching nothing but still target the row.
      sets.push('id = id');
    }
    params.push(id);
    return {
      sql: `UPDATE attachments SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  findByOwner(ownerKind: AttachmentOwnerKind, ownerId: string): AttachmentRow[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM attachments
         WHERE owner_kind = ? AND owner_id = ?
         ORDER BY sort_order ASC, created_at ASC`,
      )
      .all(ownerKind, ownerId);
    return rows.map((r) => this.mapRow(r));
  }

  countByOwners(
    ownerKind: AttachmentOwnerKind,
    ownerIds: string[],
  ): Map<string, number> {
    const result = new Map<string, number>();
    if (ownerIds.length === 0) return result;
    const placeholders = ownerIds.map(() => '?').join(',');
    const rows = this.db
      .prepare(
        `SELECT owner_id, COUNT(*) AS count
         FROM attachments
         WHERE owner_kind = ? AND owner_id IN (${placeholders})
         GROUP BY owner_id`,
      )
      .all(ownerKind, ...ownerIds) as Array<{ owner_id: string; count: number }>;
    for (const row of rows) {
      result.set(row.owner_id, row.count);
    }
    return result;
  }

  deleteByOwner(
    ownerKind: AttachmentOwnerKind,
    ownerId: string,
  ): AttachmentRow[] {
    const rows = this.findByOwner(ownerKind, ownerId);
    if (rows.length === 0) return rows;
    this.db
      .prepare('DELETE FROM attachments WHERE owner_kind = ? AND owner_id = ?')
      .run(ownerKind, ownerId);
    return rows;
  }
}
