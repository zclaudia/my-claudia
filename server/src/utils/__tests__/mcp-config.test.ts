import { describe, it, expect, vi, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { loadMcpServersFromDb } from '../mcp-config.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mcp_servers (
      name TEXT PRIMARY KEY,
      command TEXT NOT NULL,
      args TEXT,
      env TEXT,
      provider_scope TEXT,
      enabled INTEGER DEFAULT 1
    );
  `);
  return db;
}

describe('mcp-config', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it('returns empty object when no servers exist', () => {
    const result = loadMcpServersFromDb(db);
    expect(result).toEqual({});
  });

  it('loads enabled MCP servers', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run('test-server', 'node', 1);

    const result = loadMcpServersFromDb(db);
    expect(result).toEqual({
      'test-server': { command: 'node' },
    });
  });

  it('excludes disabled servers', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run('disabled', 'node', 0);

    const result = loadMcpServersFromDb(db);
    expect(result).toEqual({});
  });

  it('includes args when present', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, args, enabled) VALUES (?, ?, ?, ?)').run('s1', 'node', '["--inspect","server.js"]', 1);

    const result = loadMcpServersFromDb(db);
    expect(result['s1'].args).toEqual(['--inspect', 'server.js']);
  });

  it('includes env when present', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, env, enabled) VALUES (?, ?, ?, ?)').run('s1', 'node', '{"PORT":"3000"}', 1);

    const result = loadMcpServersFromDb(db);
    expect(result['s1'].env).toEqual({ PORT: '3000' });
  });

  it('filters by provider scope when providerType is given', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, provider_scope, enabled) VALUES (?, ?, ?, ?)').run('claude-only', 'node', '["claude"]', 1);
    db.prepare('INSERT INTO mcp_servers (name, command, provider_scope, enabled) VALUES (?, ?, ?, ?)').run('opencode-only', 'node', '["opencode"]', 1);

    const result = loadMcpServersFromDb(db, 'claude');
    expect(Object.keys(result)).toEqual(['claude-only']);
  });

  it('includes servers with no scope regardless of providerType filter', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run('universal', 'node', 1);

    const result = loadMcpServersFromDb(db, 'claude');
    expect(Object.keys(result)).toEqual(['universal']);
  });

  it('includes servers when provider_scope JSON is invalid', () => {
    db.prepare('INSERT INTO mcp_servers (name, command, provider_scope, enabled) VALUES (?, ?, ?, ?)').run('bad-scope', 'node', 'not-json', 1);

    const result = loadMcpServersFromDb(db, 'claude');
    expect(Object.keys(result)).toEqual(['bad-scope']);
  });

  it('logs loaded servers when there are results', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run('s1', 'node', 1);

    loadMcpServersFromDb(db);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Loaded 1 MCP server'));
    consoleSpy.mockRestore();
  });

  it('logs with provider type when filtered', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    db.prepare('INSERT INTO mcp_servers (name, command, enabled) VALUES (?, ?, ?)').run('s1', 'node', 1);

    loadMcpServersFromDb(db, 'claude');
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('for claude'));
    consoleSpy.mockRestore();
  });
});
