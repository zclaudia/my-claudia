import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionDraftRepository } from '../sessionDraft.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_drafts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL DEFAULT '',
      editing_by TEXT,
      editing_at INTEGER,
      updated_at INTEGER NOT NULL,
      archived_at INTEGER
    );
  `);
  return db;
}

describe('SessionDraftRepository', () => {
  let db: Database.Database;
  let repo: SessionDraftRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new SessionDraftRepository(db);
  });

  it('revives an archived draft instead of inserting a duplicate session row', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO session_drafts (id, session_id, content, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('draft-1', 'session-1', 'old content', now, now);

    const result = repo.acquireLock('session-1', 'device-a');

    expect(result.success).toBe(true);
    expect(result.draft?.id).toBe('draft-1');
    expect(result.draft?.sessionId).toBe('session-1');
    expect(result.draft?.content).toBe('');
    expect(result.draft?.editingBy).toBe('device-a');
    expect(result.draft?.archivedAt).toBeUndefined();

    const count = db.prepare('SELECT COUNT(*) AS count FROM session_drafts WHERE session_id = ?')
      .get('session-1') as { count: number };
    expect(count.count).toBe(1);
  });

  it('upsert reopens an archived draft row with new content', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO session_drafts (id, session_id, content, updated_at, archived_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('draft-1', 'session-1', 'old content', now, now);

    const draft = repo.upsert('session-1', 'new content', 'device-a');

    expect(draft.id).toBe('draft-1');
    expect(draft.content).toBe('new content');
    expect(draft.editingBy).toBe('device-a');
    expect(draft.archivedAt).toBeUndefined();
  });
});
