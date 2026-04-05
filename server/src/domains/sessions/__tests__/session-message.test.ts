import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { SessionMessageRepository } from '../message-repository.js';

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
  `);

  return db;
}

describe('SessionMessageRepository', () => {
  let db: Database.Database;
  let repo: SessionMessageRepository;

  beforeAll(() => {
    db = createTestDb();
    repo = new SessionMessageRepository(db);
  });

  afterAll(() => {
    db.close();
  });

  beforeEach(() => {
    db.exec('DELETE FROM messages');
    db.exec('DELETE FROM sessions');

    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'Session 1', now, now);
  });

  it('lists latest messages for a session', () => {
    const now = Date.now();
    for (let i = 0; i < 3; i++) {
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(`m${i}`, 's1', 'user', `Message ${i}`, null, now + i, i);
    }

    const messages = repo.listBySession('s1', { limit: 2 });

    expect(messages).toHaveLength(2);
    expect(messages[0].id).toBe('m2');
    expect(messages[1].id).toBe('m1');
  });

  it('returns a window around target message', () => {
    const now = Date.now();
    for (let i = 0; i < 6; i++) {
      db.prepare(`
        INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(`m${i}`, 's1', 'user', `Message ${i}`, null, now + i, i + 1);
    }

    const messages = repo.listBySession('s1', { limit: 5, aroundMessageId: 'm3' });

    expect(messages.map(message => message.id)).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']);
  });

  it('creates a message and stores metadata as JSON', () => {
    const createdAt = Date.now();
    const message = repo.create({
      id: 'm1',
      sessionId: 's1',
      role: 'assistant',
      content: 'Hello',
      metadata: { tokenCount: 42 },
      createdAt,
    });

    expect(message.id).toBe('m1');
    expect(message.metadata).toBe(JSON.stringify({ tokenCount: 42 }));
    expect(repo.findRowIdById('m1')).not.toBeNull();
  });

  it('updates session timestamp', () => {
    const updatedAt = Date.now() + 1000;

    repo.updateSessionTimestamp('s1', updatedAt);

    const row = db.prepare('SELECT updated_at FROM sessions WHERE id = ?').get('s1') as { updated_at: number };
    expect(row.updated_at).toBe(updatedAt);
  });
});
