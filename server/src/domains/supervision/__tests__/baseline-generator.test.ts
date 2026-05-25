import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { BASELINE_PROVIDER_ADAPTERS, resolveBaselineProvider } from '../baseline-generator.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE providers (
      id TEXT PRIMARY KEY,
      name TEXT,
      type TEXT NOT NULL,
      cli_path TEXT,
      env TEXT,
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  return db;
}

describe('baseline-generator', () => {
  it('registers an OpenClaude adapter for AI baseline generation', () => {
    expect(BASELINE_PROVIDER_ADAPTERS.openclaude).toBeDefined();
    expect(BASELINE_PROVIDER_ADAPTERS.openclaude.providerType).toBe('openclaude');
  });

  it('selects an OpenClaude provider as the default AI baseline provider', () => {
    const db = createTestDb();
    const now = Date.now();

    db.prepare(`
      INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('provider-openclaude', 'OpenClaude Default', 'openclaude', 1, now, now);

    db.prepare(`
      INSERT INTO providers (id, name, type, is_default, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('provider-claude', 'Claude Secondary', 'claude', 0, now - 1, now - 1);

    const provider = resolveBaselineProvider(db);

    expect(provider).toMatchObject({
      id: 'provider-openclaude',
      type: 'openclaude',
    });
  });
});
