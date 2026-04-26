import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { reindexAllMessages } from './metadata-extractor.js';
import { migrations } from './migrations/index.js';

const DB_DIR = process.env.MY_CLAUDIA_DATA_DIR
  ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR)
  : path.join(os.homedir(), '.my-claudia');
const DB_PATH = path.join(DB_DIR, 'data.db');

export function initDatabase(): Database.Database {
  // Ensure directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Run migrations
  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const appliedMigrations = new Set(
    (db.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((row) => row.name)
  );

  for (const migration of migrations) {
    if (appliedMigrations.has(migration.name)) continue;

    console.log(`Applying migration: ${migration.name}`);
    try {
      db.exec(migration.sql);
    } catch (error) {
      // Idempotent migrations tolerate duplicate column errors (schema already applied
      // at the DB level but migration record was missing).
      if (migration.idempotent) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('duplicate column name:')) {
          console.warn(`Migration ${migration.name} already applied at schema level, marking as applied.`);
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
      migration.name,
      Date.now()
    );

    // Special post-migration tasks
    if (migration.name === '008_extended_search') {
      console.log('Running post-migration indexing for extended search...');
      reindexAllMessages(db);
    }
  }

  // Self-heal historical inconsistent schemas where migration records exist
  // but local_prs columns are still missing on disk.
  selfHealLocalPrs(db);
}

function selfHealLocalPrs(db: Database.Database): void {
  const hasTable = Boolean(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_prs'").get()
  );
  if (!hasTable) return;

  const columns = new Set(
    (db.prepare("PRAGMA table_info(local_prs)").all() as Array<{ name: string }>).map((r) => r.name)
  );

  for (const col of ['status_message', 'merged_commit_sha']) {
    if (!columns.has(col)) {
      console.warn(`Schema self-heal: adding missing local_prs.${col}`);
      db.exec(`ALTER TABLE local_prs ADD COLUMN ${col} TEXT`);
    }
  }
}

export type { Database };
