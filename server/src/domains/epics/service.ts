// server/src/domains/epics/service.ts
//
// Epic lifecycle (C5). Epics are LocalIssue containers; their lifecycle
// runs on a simple 3-state machine.

import type { Database } from 'better-sqlite3';
import type { Epic, EpicStatus } from '@my-claudia/shared/features/epic';
import type { LocalIssue } from '@my-claudia/shared/features/local-issue';
import { EpicRepository, type EpicCreate, type EpicUpdate } from './repository.js';

const EPIC_TRANSITIONS: Record<EpicStatus, EpicStatus[]> = {
  open: ['closed', 'cancelled'],
  closed: ['open'],
  cancelled: [],
};

export class EpicService {
  private repo: EpicRepository;

  constructor(db: Database) {
    this.repo = new EpicRepository(db);
  }

  getRepo(): EpicRepository {
    return this.repo;
  }

  createEpic(data: EpicCreate): Epic {
    return this.repo.create(data);
  }

  listEpics(projectId: string): Epic[] {
    return this.repo.findByProjectId(projectId);
  }

  getEpic(epicId: string): Epic | null {
    return this.repo.findById(epicId);
  }

  updateEpic(epicId: string, data: EpicUpdate): Epic {
    return this.repo.update(epicId, data);
  }

  /**
   * Transition Epic status. Validates the legal transitions in
   * `EPIC_TRANSITIONS`. Closing an Epic does *not* auto-close child
   * LocalIssues — that's a manual step (parity with pre-C5 behavior
   * where "Close Feature" was gated on all sub-issues being closed).
   */
  transitionStatus(epicId: string, next: EpicStatus): Epic {
    const current = this.repo.findById(epicId);
    if (!current) throw new Error(`Epic not found: ${epicId}`);
    if (current.status === next) return current;
    const allowed = EPIC_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`Illegal epic status transition: ${current.status} → ${next}`);
    }
    return this.repo.update(epicId, {
      status: next,
      closedAt: (next === 'closed' || next === 'cancelled') ? Date.now() : undefined,
    });
  }

  deleteEpic(epicId: string): boolean {
    return this.repo.delete(epicId);
  }

  /**
   * List LocalIssues grouped under an Epic (read-only convenience —
   * uses the FK column `epic_id` rebuilt by migration 075).
   */
  listIssuesForEpic(db: Database, epicId: string): LocalIssue[] {
    const rows = db
      .prepare(`SELECT * FROM local_issues WHERE epic_id = ? ORDER BY created_at ASC`)
      .all(epicId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: row.id as string,
      projectId: row.project_id as string,
      title: row.title as string,
      description: (row.description as string) || undefined,
      status: row.status as LocalIssue['status'],
      priority: row.priority as LocalIssue['priority'],
      labels: row.labels ? JSON.parse(row.labels as string) : [],
      type: row.type as LocalIssue['type'],
      epicId: (row.epic_id as string) || undefined,
      specChangeId: (row.spec_change_id as string) || undefined,
      isAnonymous: row.is_anonymous === 1,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
      closedAt: (row.closed_at as number) || undefined,
    }));
  }
}
