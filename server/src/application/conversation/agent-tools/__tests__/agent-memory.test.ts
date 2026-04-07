import { beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { registerAgentTools } from '../index.js';
import { toolRegistry } from '../../../../application/plugins/index.js';

function createDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      project_id TEXT
    );

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
  `);
  db.prepare(`INSERT INTO sessions (id, project_id) VALUES ('session-1', 'project-1')`).run();
  return db;
}

describe('agent-tools/agent_memory', () => {
  let db: Database.Database;

  beforeEach(() => {
    toolRegistry.clear();
    db = createDb();
    registerAgentTools({ getDb: () => db });
  });

  it('stores and reads project-scoped memory via the tool handler', async () => {
    const setResult = await toolRegistry.execute(
      'agent_memory',
      { operation: 'set', namespace: 'prefs', key: 'editor', value: 'vim' },
      { sessionId: 'session-1' },
      'agent-assistant',
    );
    const getResult = await toolRegistry.execute(
      'agent_memory',
      { operation: 'get', namespace: 'prefs', key: 'editor' },
      { sessionId: 'session-1' },
      'agent-assistant',
    );
    const listResult = await toolRegistry.execute(
      'agent_memory',
      { operation: 'list', namespace: 'prefs' },
      { sessionId: 'session-1' },
      'agent-assistant',
    );

    expect(JSON.parse(setResult)).toEqual({
      success: true,
      key: 'editor',
      namespace: 'prefs',
    });
    expect(getResult).toBe('vim');
    expect(JSON.parse(listResult)).toEqual([
      expect.objectContaining({
        projectId: 'project-1',
        namespace: 'prefs',
        key: 'editor',
        value: 'vim',
      }),
    ]);
  });

  it('uses global scope when no session context is provided', async () => {
    await toolRegistry.execute(
      'agent_memory',
      { operation: 'set', namespace: 'prefs', key: 'theme', value: 'dark' },
      undefined,
      'agent-assistant',
    );

    const rawRows = db.prepare(
      'SELECT project_id, key, value FROM agent_memory WHERE namespace = ?'
    ).all('prefs') as Array<{ project_id: string | null; key: string; value: string }>;

    expect(rawRows).toEqual([
      { project_id: null, key: 'theme', value: 'dark' },
    ]);
  });

  it('deletes only the matching memory entry', async () => {
    await toolRegistry.execute(
      'agent_memory',
      { operation: 'set', namespace: 'prefs', key: 'shell', value: 'zsh' },
      { sessionId: 'session-1' },
      'agent-assistant',
    );

    const deleteResult = await toolRegistry.execute(
      'agent_memory',
      { operation: 'delete', namespace: 'prefs', key: 'shell' },
      { sessionId: 'session-1' },
      'agent-assistant',
    );
    const getResult = await toolRegistry.execute(
      'agent_memory',
      { operation: 'get', namespace: 'prefs', key: 'shell' },
      { sessionId: 'session-1' },
      'agent-assistant',
    );

    expect(JSON.parse(deleteResult)).toEqual({ deleted: true });
    expect(JSON.parse(getResult)).toEqual({ found: false });
  });
});
