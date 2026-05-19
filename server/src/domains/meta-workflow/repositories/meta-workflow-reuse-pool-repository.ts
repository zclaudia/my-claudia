// server/src/domains/meta-workflow/repositories/meta-workflow-reuse-pool-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  ReusablePoolItem,
  ReusablePoolMetadata,
  ExecuteEntity,
  PhaseType,
  ReusePoolSourceType,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<ReusablePoolItem, 'id' | 'archivedAt'>;
type Update = {
  description?: string | null;
  tags?: string[];
  sourceType?: ReusePoolSourceType;
  metadata?: ReusablePoolMetadata | null;
  archivedAt?: number | null;
};

export class MetaWorkflowReusePoolRepository extends BaseRepository<ReusablePoolItem, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_workflow_reuse_pool');
  }

  mapRow(raw: unknown): ReusablePoolItem {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      kind: row.kind as ExecuteEntity,
      entityId: row.entity_id as string,
      phaseType: row.phase_type as PhaseType,
      description: (row.description as string) || undefined,
      tags: row.tags ? (JSON.parse(row.tags as string) as string[]) : [],
      sourceType: row.source_type as ReusePoolSourceType,
      metadata: row.metadata
        ? (JSON.parse(row.metadata as string) as ReusablePoolMetadata)
        : undefined,
      createdAt: row.created_at as number,
      archivedAt: (row.archived_at as number) || undefined,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_workflow_reuse_pool (
        id, kind, entity_id, phase_type, description, tags,
        source_type, metadata, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.kind, data.entityId, data.phaseType,
        data.description ?? null,
        JSON.stringify(data.tags),
        data.sourceType,
        data.metadata ? JSON.stringify(data.metadata) : null,
        data.createdAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];

    if (data.description !== undefined) { sets.push('description = ?'); params.push(data.description ?? null); }
    if (data.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(data.tags)); }
    if (data.sourceType !== undefined) { sets.push('source_type = ?'); params.push(data.sourceType); }
    if (data.metadata !== undefined) {
      sets.push('metadata = ?');
      params.push(data.metadata ? JSON.stringify(data.metadata) : null);
    }
    if (data.archivedAt !== undefined) { sets.push('archived_at = ?'); params.push(data.archivedAt ?? null); }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_workflow_reuse_pool WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return {
      sql: `UPDATE meta_workflow_reuse_pool SET ${sets.join(', ')} WHERE id = ?`,
      params,
    };
  }

  /**
   * Find non-archived items for a given phaseType (used by the search service).
   */
  findByPhaseType(phaseType: PhaseType): ReusablePoolItem[] {
    const rows = this.db.prepare(
      `SELECT * FROM meta_workflow_reuse_pool
         WHERE phase_type = ? AND archived_at IS NULL
         ORDER BY source_type DESC, created_at DESC`,
    ).all(phaseType);
    return rows.map((r) => this.mapRow(r));
  }

  /**
   * List all non-archived items, optionally filtered by phaseType.
   * Ordered: user-promoted first (source_type DESC), then by creation time DESC.
   */
  listActive(phaseType?: string): ReusablePoolItem[] {
    const rows = phaseType
      ? this.db.prepare(
          `SELECT * FROM meta_workflow_reuse_pool
             WHERE phase_type = ? AND archived_at IS NULL
             ORDER BY source_type DESC, created_at DESC`,
        ).all(phaseType)
      : this.db.prepare(
          `SELECT * FROM meta_workflow_reuse_pool
             WHERE archived_at IS NULL
             ORDER BY source_type DESC, created_at DESC`,
        ).all();
    return rows.map((r) => this.mapRow(r));
  }

  archive(id: string): void {
    this.db.prepare(
      `UPDATE meta_workflow_reuse_pool SET archived_at = ? WHERE id = ?`,
    ).run(Date.now(), id);
  }

  /**
   * Promote a pool item from 'auto' → 'user', replacing tags entirely.
   * Returns the updated item.
   */
  promote(id: string, newTags: string[]): ReusablePoolItem {
    return this.update(id, { sourceType: 'user', tags: newTags });
  }

  updateMetadata(id: string, metadata: ReusablePoolMetadata): void {
    this.update(id, { metadata });
  }
}
