import type { Database } from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import type { LocalIssueComment } from '@my-claudia/shared/features/local-issue';

export class LocalIssueCommentRepository {
  constructor(private db: Database) {}

  private mapRow(raw: unknown): LocalIssueComment {
    const row = raw as Record<string, unknown>;
    return {
      id: row.id as string,
      issueId: row.issue_id as string,
      body: row.body as string,
      createdAt: row.created_at as number,
      updatedAt: row.updated_at as number,
    };
  }

  findById(id: string): LocalIssueComment | null {
    const row = this.db.prepare('SELECT * FROM local_issue_comments WHERE id = ?').get(id);
    return row ? this.mapRow(row) : null;
  }

  findByIssue(issueId: string): LocalIssueComment[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM local_issue_comments WHERE issue_id = ? ORDER BY created_at ASC',
      )
      .all(issueId);
    return rows.map((r) => this.mapRow(r));
  }

  create(issueId: string, body: string): LocalIssueComment {
    const id = uuidv4();
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO local_issue_comments (id, issue_id, body, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, issueId, body, now, now);
    const created = this.findById(id);
    if (!created) throw new Error(`Failed to create comment ${id}`);
    return created;
  }

  updateBody(id: string, body: string): LocalIssueComment {
    const now = Date.now();
    const result = this.db
      .prepare('UPDATE local_issue_comments SET body = ?, updated_at = ? WHERE id = ?')
      .run(body, now, id);
    if (result.changes === 0) {
      throw new Error(`Comment ${id} not found`);
    }
    const updated = this.findById(id);
    if (!updated) throw new Error(`Comment ${id} disappeared after update`);
    return updated;
  }

  delete(id: string): boolean {
    const result = this.db.prepare('DELETE FROM local_issue_comments WHERE id = ?').run(id);
    return result.changes > 0;
  }

  deleteByIssue(issueId: string): void {
    this.db.prepare('DELETE FROM local_issue_comments WHERE issue_id = ?').run(issueId);
  }
}
