import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';

export type CandidatePhase =
  | 'discovered'
  | 'excluded'
  | 'generating'
  | 'generated'
  | 'approved'
  | 'rejected'
  | 'failed';

export type CandidateSource = 'ai_discovered' | 'user_added';

export interface BootstrapCandidate {
  id: string;
  scanId: string;
  capability: string;
  title: string;
  description: string;
  source: CandidateSource;
  selected: boolean;
  phase: CandidatePhase;
  generated_md: string | null;
  generation_attempts: number;
  error_message: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BootstrapCandidateCreate {
  scanId: string;
  capability: string;
  title: string;
  description: string;
  source: CandidateSource;
  selected?: boolean;
  phase?: CandidatePhase;
}

export interface BootstrapCandidateUpdate {
  title?: string;
  description?: string;
  selected?: boolean;
  phase?: CandidatePhase;
  generated_md?: string | null;
  generation_attempts?: number;
  error_message?: string | null;
}

interface Row {
  id: string;
  scan_id: string;
  capability: string;
  title: string;
  description: string;
  source: string;
  selected: number;
  phase: string;
  generated_md: string | null;
  generation_attempts: number;
  error_message: string | null;
  created_at: number;
  updated_at: number;
}

export class BootstrapCandidateRepository {
  constructor(private db: Database) {}

  private mapRow(row: unknown): BootstrapCandidate {
    const r = row as Row;
    return {
      id: r.id,
      scanId: r.scan_id,
      capability: r.capability,
      title: r.title,
      description: r.description,
      source: r.source as CandidateSource,
      selected: r.selected === 1,
      phase: r.phase as CandidatePhase,
      generated_md: r.generated_md,
      generation_attempts: r.generation_attempts,
      error_message: r.error_message,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  create(data: BootstrapCandidateCreate): BootstrapCandidate {
    const id = uuidv4();
    const now = Date.now();
    this.db.prepare(
      `INSERT INTO bootstrap_candidates
        (id, scan_id, capability, title, description, source, selected, phase,
         generation_attempts, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    ).run(
      id,
      data.scanId,
      data.capability,
      data.title,
      data.description,
      data.source,
      data.selected === false ? 0 : 1,
      data.phase ?? 'discovered',
      now,
      now,
    );
    return this.findById(id)!;
  }

  findById(id: string): BootstrapCandidate | null {
    const row = this.db.prepare(`SELECT * FROM bootstrap_candidates WHERE id = ?`).get(id);
    return row ? this.mapRow(row) : null;
  }

  listByScan(scanId: string): BootstrapCandidate[] {
    const rows = this.db
      .prepare(`SELECT * FROM bootstrap_candidates WHERE scan_id = ? ORDER BY created_at`)
      .all(scanId);
    return rows.map((r) => this.mapRow(r));
  }

  listSelected(scanId: string): BootstrapCandidate[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM bootstrap_candidates
         WHERE scan_id = ? AND selected = 1 AND phase != 'excluded'
         ORDER BY created_at`
      )
      .all(scanId);
    return rows.map((r) => this.mapRow(r));
  }

  update(id: string, data: BootstrapCandidateUpdate): BootstrapCandidate {
    const sets: string[] = [];
    const params: unknown[] = [];
    if (data.title !== undefined)               { sets.push('title = ?');               params.push(data.title); }
    if (data.description !== undefined)         { sets.push('description = ?');         params.push(data.description); }
    if (data.selected !== undefined)            { sets.push('selected = ?');            params.push(data.selected ? 1 : 0); }
    if (data.phase !== undefined)               { sets.push('phase = ?');               params.push(data.phase); }
    if (data.generated_md !== undefined)        { sets.push('generated_md = ?');        params.push(data.generated_md); }
    if (data.generation_attempts !== undefined) { sets.push('generation_attempts = ?'); params.push(data.generation_attempts); }
    if (data.error_message !== undefined)       { sets.push('error_message = ?');       params.push(data.error_message); }
    sets.push('updated_at = ?');
    params.push(Date.now());
    params.push(id);
    if (sets.length > 1) {
      this.db.prepare(`UPDATE bootstrap_candidates SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    return this.findById(id)!;
  }

  delete(id: string): void {
    this.db.prepare(`DELETE FROM bootstrap_candidates WHERE id = ?`).run(id);
  }
}
