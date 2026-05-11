import type { Database } from 'better-sqlite3';
import type { TurnSummary } from '@my-claudia/shared/features/turn-summary';

export class TurnSummaryRepository {
  constructor(private db: Database) {}

  private mapRow(raw: unknown): TurnSummary {
    const row = raw as Record<string, unknown>;
    return {
      sessionId: row.session_id as string,
      userMessageId: row.user_message_id as string,
      asOfMessageId: row.as_of_message_id as string,
      goal: row.goal as string,
      solved: row.solved as string,
      openIssues: row.open_issues as string,
      model: row.model as string,
      generatedAt: row.generated_at as number,
    };
  }

  findByTurn(sessionId: string, userMessageId: string): TurnSummary | null {
    const row = this.db
      .prepare(
        'SELECT * FROM turn_summaries WHERE session_id = ? AND user_message_id = ?',
      )
      .get(sessionId, userMessageId);
    return row ? this.mapRow(row) : null;
  }

  listBySession(sessionId: string): TurnSummary[] {
    const rows = this.db
      .prepare(
        'SELECT * FROM turn_summaries WHERE session_id = ? ORDER BY generated_at DESC',
      )
      .all(sessionId);
    return rows.map((r) => this.mapRow(r));
  }

  upsert(summary: TurnSummary): void {
    this.db
      .prepare(
        `INSERT INTO turn_summaries (
          session_id, user_message_id, as_of_message_id,
          goal, solved, open_issues, model, generated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, user_message_id) DO UPDATE SET
          as_of_message_id = excluded.as_of_message_id,
          goal             = excluded.goal,
          solved           = excluded.solved,
          open_issues      = excluded.open_issues,
          model            = excluded.model,
          generated_at     = excluded.generated_at`,
      )
      .run(
        summary.sessionId,
        summary.userMessageId,
        summary.asOfMessageId,
        summary.goal,
        summary.solved,
        summary.openIssues,
        summary.model,
        summary.generatedAt,
      );
  }

  deleteBySession(sessionId: string): void {
    this.db
      .prepare('DELETE FROM turn_summaries WHERE session_id = ?')
      .run(sessionId);
  }
}
