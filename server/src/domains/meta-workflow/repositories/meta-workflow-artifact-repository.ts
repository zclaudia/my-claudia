// server/src/domains/meta-workflow/repositories/meta-workflow-artifact-repository.ts
import { BaseRepository } from '../../../infrastructure/repositories/base.js';
import type { Database } from 'better-sqlite3';
import type {
  MetaWorkflowArtifact,
  MetaWorkflowGateResult,
} from '@my-claudia/shared/features/meta-workflow';
import { v4 as uuidv4 } from 'uuid';

type Create = Omit<MetaWorkflowArtifact, 'id'>;
type Update = {
  commitSha?: string | null;
  artifactFiles?: MetaWorkflowArtifact['artifactFiles'] | null;
  gateResults?: MetaWorkflowArtifact['gateResults'] | null;
  aiReviewNotesPath?: string | null;
  status?: MetaWorkflowArtifact['status'];
};

export class MetaWorkflowArtifactRepository extends BaseRepository<MetaWorkflowArtifact, Create, Update> {
  constructor(db: Database) {
    super(db, 'meta_workflow_artifacts');
  }

  mapRow(raw: unknown): MetaWorkflowArtifact {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      phaseRecordId: row.phase_record_id as string,
      version: row.version as number,
      commitSha: (row.commit_sha as string) || undefined,
      artifactFiles: row.artifact_files
        ? (JSON.parse(row.artifact_files as string) as MetaWorkflowArtifact['artifactFiles'])
        : undefined,
      gateResults: row.gate_results
        ? (JSON.parse(row.gate_results as string) as MetaWorkflowGateResult[])
        : undefined,
      aiReviewNotesPath: (row.ai_review_notes_path as string) || undefined,
      status: row.status as MetaWorkflowArtifact['status'],
      createdAt: row.created_at as number,
    };
  }

  createQuery(data: Create): { sql: string; params: unknown[] } {
    const id = uuidv4();
    return {
      sql: `INSERT INTO meta_workflow_artifacts (
        id, phase_record_id, version, commit_sha, artifact_files,
        gate_results, ai_review_notes_path, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        id, data.phaseRecordId, data.version,
        data.commitSha ?? null,
        data.artifactFiles ? JSON.stringify(data.artifactFiles) : null,
        data.gateResults ? JSON.stringify(data.gateResults) : null,
        data.aiReviewNotesPath ?? null,
        data.status,
        data.createdAt,
      ],
    };
  }

  updateQuery(id: string, data: Update): { sql: string; params: unknown[] } {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.commitSha !== undefined) { sets.push('commit_sha = ?'); params.push(data.commitSha ?? null); }
    if (data.artifactFiles !== undefined) {
      sets.push('artifact_files = ?');
      params.push(data.artifactFiles ? JSON.stringify(data.artifactFiles) : null);
    }
    if (data.gateResults !== undefined) {
      sets.push('gate_results = ?');
      params.push(data.gateResults ? JSON.stringify(data.gateResults) : null);
    }
    if (data.aiReviewNotesPath !== undefined) { sets.push('ai_review_notes_path = ?'); params.push(data.aiReviewNotesPath ?? null); }
    if (data.status !== undefined) { sets.push('status = ?'); params.push(data.status); }

    if (sets.length === 0) {
      return { sql: `SELECT 1 FROM meta_workflow_artifacts WHERE id = ?`, params: [id] };
    }
    params.push(id);
    return { sql: `UPDATE meta_workflow_artifacts SET ${sets.join(', ')} WHERE id = ?`, params };
  }

  findByPhase(phaseRecordId: string): MetaWorkflowArtifact[] {
    const rows = this.db.prepare(
      `SELECT * FROM meta_workflow_artifacts WHERE phase_record_id = ? ORDER BY version DESC`,
    ).all(phaseRecordId);
    return rows.map((r) => this.mapRow(r));
  }

  findLatestByPhase(phaseRecordId: string): MetaWorkflowArtifact | null {
    const row = this.db.prepare(
      `SELECT * FROM meta_workflow_artifacts WHERE phase_record_id = ? ORDER BY version DESC LIMIT 1`,
    ).get(phaseRecordId);
    return row ? this.mapRow(row) : null;
  }

  markAllStaleForPhase(phaseRecordId: string): void {
    this.db.prepare(
      `UPDATE meta_workflow_artifacts SET status = 'stale'
         WHERE phase_record_id = ? AND status = 'active'`,
    ).run(phaseRecordId);
  }
}
