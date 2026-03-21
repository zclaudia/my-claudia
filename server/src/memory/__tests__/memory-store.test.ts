import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { recordActivity, getRecentActivity } from '../activity-log.js';
import { MemoryStore } from '../memory-store.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE agent_memory (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      namespace TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      author_scope TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE agent_activity_log (
      id TEXT PRIMARY KEY,
      project_id TEXT,
      session_id TEXT,
      type TEXT NOT NULL,
      summary TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('memory-store', () => {
  let db: Database.Database;
  let store: MemoryStore;

  beforeEach(() => {
    db = createTestDb();
    store = new MemoryStore(db);
  });

  it('keeps global and project-scoped memories distinct for the same namespace/key', () => {
    store.set(null, 'prefs', 'editor', 'vim', 'global');
    store.set('project-1', 'prefs', 'editor', 'vscode');

    expect(store.get(null, 'prefs', 'editor')).toBe('vim');
    expect(store.get('project-1', 'prefs', 'editor')).toBe('vscode');
    expect(store.list(null)).toHaveLength(1);
    expect(store.list('project-1')).toHaveLength(1);
  });

  it('updates an existing global memory instead of inserting a duplicate row', () => {
    store.set(null, 'prefs', 'theme', 'light', 'global');
    store.set(null, 'prefs', 'theme', 'dark', 'global');

    const rows = db.prepare(
      'SELECT value FROM agent_memory WHERE project_id IS NULL AND namespace = ? AND key = ?'
    ).all('prefs', 'theme') as Array<{ value: string }>;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.value).toBe('dark');
  });

  it('deletes only the targeted scope', () => {
    store.set(null, 'prefs', 'shell', 'zsh', 'global');
    store.set('project-1', 'prefs', 'shell', 'bash');

    expect(store.delete(null, 'prefs', 'shell')).toBe(true);
    expect(store.get(null, 'prefs', 'shell')).toBeUndefined();
    expect(store.get('project-1', 'prefs', 'shell')).toBe('bash');
  });

  it('returns project and global memories together for context injection', () => {
    store.set(null, 'prefs', 'theme', 'dark', 'global');
    store.set('project-1', 'prefs', 'theme', 'light');
    store.set('project-2', 'prefs', 'theme', 'solarized');

    const memories = store.getProjectAndGlobalMemories('project-1');

    expect(memories.map(entry => [entry.projectId, entry.value])).toEqual(
      expect.arrayContaining([
        [null, 'dark'],
        ['project-1', 'light'],
      ]),
    );
    expect(memories.some(entry => entry.projectId === 'project-2')).toBe(false);
  });
});

describe('activity-log', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('parses valid metadata payloads', () => {
    recordActivity(db, {
      projectId: 'project-1',
      sessionId: 'session-1',
      type: 'summary',
      summary: 'Finished work',
      metadata: { runId: 'run-1' },
    });

    const entries = getRecentActivity(db, 'project-1');

    expect(entries).toHaveLength(1);
    expect(entries[0]?.metadata).toEqual({ runId: 'run-1' });
  });

  it('ignores corrupted metadata instead of throwing', () => {
    db.prepare(`
      INSERT INTO agent_activity_log (id, project_id, session_id, type, summary, metadata, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('log-1', 'project-1', 'session-1', 'summary', 'Broken metadata', '{bad json', Date.now());

    expect(() => getRecentActivity(db, 'project-1')).not.toThrow();
    expect(getRecentActivity(db, 'project-1')[0]?.metadata).toBeUndefined();
  });
});
