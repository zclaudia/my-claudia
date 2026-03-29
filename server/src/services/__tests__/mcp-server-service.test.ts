import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { McpServerService, McpServerServiceError } from '../mcp-server-service.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      command TEXT NOT NULL,
      args TEXT,
      env TEXT,
      enabled INTEGER DEFAULT 1,
      description TEXT,
      source TEXT DEFAULT 'user',
      provider_scope TEXT,
      created_at INTEGER,
      updated_at INTEGER
    )
  `);
  return db;
}

describe('McpServerService', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  it('creates, lists, updates and toggles servers', () => {
    const service = new McpServerService(db, () => 1234, () => ({}));

    const created = service.createServer({
      name: 'srv',
      command: 'node',
      args: ['server.js'],
      env: { PORT: '3000' },
      providerScope: ['claude'],
    });
    expect(created.name).toBe('srv');
    expect(service.listServers()).toHaveLength(1);

    const updated = service.updateServer(created.id, {
      name: 'srv-updated',
      command: 'python',
      description: 'Test',
    });
    expect(updated.name).toBe('srv-updated');
    expect(updated.command).toBe('python');

    const toggled = service.toggleServer(created.id);
    expect(toggled.enabled).toBe(false);
  });

  it('imports native servers and skips duplicates', () => {
    const service = new McpServerService(
      db,
      () => 1234,
      () => ({
        importedSrv: { command: 'node', args: ['index.js'], env: { PORT: '3000' } },
      }),
    );

    const first = service.importServers();
    expect(first.imported).toHaveLength(1);
    expect(first.skipped).toEqual([]);

    const second = service.importServers();
    expect(second.imported).toHaveLength(0);
    expect(second.skipped).toEqual(['importedSrv']);
  });

  it('throws structured errors for missing and duplicate servers', () => {
    const service = new McpServerService(db, () => 1234, () => ({}));
    service.createServer({ name: 'srv', command: 'node' });

    expect(() => service.createServer({ name: 'srv', command: 'node' })).toThrowError(McpServerServiceError);
    expect(() => service.updateServer('missing', { name: 'x' })).toThrowError(McpServerServiceError);
    expect(() => service.deleteServer('missing')).toThrowError(McpServerServiceError);
  });
});
