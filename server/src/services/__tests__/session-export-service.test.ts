import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SessionExportError, SessionExportService } from '../../domains/sessions/export-service.js';

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
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('SessionExportService', () => {
  let db: Database.Database;
  let service: SessionExportService;

  beforeEach(() => {
    db = createTestDb();
    service = new SessionExportService(db);
  });

  afterEach(() => {
    db.close();
  });

  it('exports session markdown with messages and metadata summaries', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'project-1', 'Export Session', now, now);
    db.prepare(`
      INSERT INTO messages (id, session_id, role, content, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      'm1',
      's1',
      'assistant',
      'Done',
      JSON.stringify({
        toolCalls: [{ name: 'Read', input: { file_path: '/foo.ts' }, isError: false }],
        usage: { inputTokens: 1200, outputTokens: 300 },
      }),
      now,
    );

    const result = service.exportSession('s1');

    expect(result.sessionName).toBe('Export Session');
    expect(result.markdown).toContain('# Export Session');
    expect(result.markdown).toContain('**Tool Calls:**');
    expect(result.markdown).toContain('**Read**');
    expect(result.markdown).toContain('-> ok');
    expect(result.markdown).toContain('1,200');
  });

  it('falls back to Untitled Session when name is null', () => {
    const now = Date.now();
    db.prepare(`
      INSERT INTO sessions (id, project_id, name, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('s1', 'project-1', null, now, now);

    const result = service.exportSession('s1');

    expect(result.sessionName).toBe('Untitled Session');
    expect(result.markdown).toContain('# Untitled Session');
  });

  it('throws NOT_FOUND for missing session', () => {
    expect(() => service.exportSession('missing')).toThrowError(SessionExportError);
  });
});
