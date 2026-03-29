import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { SessionSearchRepository } from '../session-search.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      name TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL,
      offset INTEGER
    );

    CREATE TABLE search_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL DEFAULT 'default',
      query TEXT NOT NULL,
      result_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE messages_fts USING fts5(
      content, session_id UNINDEXED, role UNINDEXED
    );

    CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
      INSERT INTO messages_fts(rowid, content, session_id, role)
      VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
    END;

    CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
      INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
      VALUES('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.role);
    END;
  `);

  return db;
}

describe('SessionSearchRepository', () => {
  let db: Database.Database;
  let repo: SessionSearchRepository;

  beforeEach(() => {
    db = createTestDb();
    repo = new SessionSearchRepository(db);

    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'Session 1', now, now);
  });

  afterEach(() => {
    db.close();
  });

  it('searches indexed session messages', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('m1', 's1', 'user', 'authentication request', now);

    const results = repo.search({
      q: 'authentication',
      sort: 'relevance',
      scope: 'messages',
      limit: 10,
      offset: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe('m1');
    expect(results[0].sessionName).toBe('Session 1');
  });

  it('filters search results by role', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('m1', 's1', 'user', 'authentication request', now);
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('m2', 's1', 'assistant', 'authentication response', now + 1);

    const results = repo.search({
      q: 'authentication',
      role: 'assistant',
      sort: 'relevance',
      scope: 'messages',
      limit: 10,
      offset: 0,
    });

    expect(results).toHaveLength(1);
    expect(results[0].role).toBe('assistant');
  });

  it('stores and returns search history suggestions', () => {
    repo.saveHistory('authentication setup', 3);
    repo.saveHistory('auth token', 2);

    const history = repo.getHistory('default', 10);
    const suggestions = repo.getSuggestions('auth', 'default', 10);

    expect(history).toHaveLength(2);
    expect(suggestions).toHaveLength(2);
    expect(suggestions).toContain('auth token');
    expect(suggestions).toContain('authentication setup');
  });
});
