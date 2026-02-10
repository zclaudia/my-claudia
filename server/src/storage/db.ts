import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { reindexAllMessages } from './metadata-extractor.js';

const DB_DIR = path.join(os.homedir(), '.my-claudia');
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

  const migrations: Array<{ name: string; sql: string }> = [
    {
      name: '001_initial_schema',
      sql: `
        -- providers 表 (用户配置的多 Provider)
        CREATE TABLE IF NOT EXISTS providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'claude',
          cli_path TEXT,
          env TEXT,
          is_default INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- projects 表
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
          provider_id TEXT,
          root_path TEXT,
          system_prompt TEXT,
          permission_policy TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
        );

        -- sessions 表
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT,
          provider_id TEXT,
          sdk_session_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
        );

        -- messages 表
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        -- permission_logs 表
        CREATE TABLE IF NOT EXISTS permission_logs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          tool TEXT NOT NULL,
          detail TEXT NOT NULL,
          decision TEXT CHECK(decision IN ('allow', 'deny', 'timeout')) NOT NULL,
          remembered INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
        CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_permission_logs_session_id ON permission_logs(session_id);
      `
    },
    {
      name: '002_gateway_config',
      sql: `
        -- gateway_config 表 (Server 连接到 Gateway 的配置)
        CREATE TABLE IF NOT EXISTS gateway_config (
          id INTEGER PRIMARY KEY CHECK(id = 1), -- 单例配置
          enabled INTEGER NOT NULL DEFAULT 0,
          gateway_url TEXT,
          gateway_secret TEXT,
          backend_name TEXT,
          backend_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- 插入默认配置
        INSERT OR IGNORE INTO gateway_config (id, enabled, created_at, updated_at)
        VALUES (1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
      `
    },
    {
      name: '003_servers_table',
      sql: `
        -- servers 表 (Client 连接的 Server/Backend 配置)
        CREATE TABLE IF NOT EXISTS servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          address TEXT NOT NULL,
          connection_mode TEXT CHECK(connection_mode IN ('direct', 'gateway')) DEFAULT 'direct',

          -- Gateway mode fields
          gateway_url TEXT,
          gateway_secret TEXT,
          backend_id TEXT,

          -- Common fields
          api_key TEXT,
          client_id TEXT,
          is_default INTEGER DEFAULT 0,
          requires_auth INTEGER DEFAULT 0,

          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_connected INTEGER
        );

        -- 插入默认的 local server
        INSERT OR IGNORE INTO servers (
          id, name, address, connection_mode, is_default, requires_auth,
          created_at, updated_at
        ) VALUES (
          'local',
          'Local Server',
          'localhost:3100',
          'direct',
          1,
          0,
          strftime('%s', 'now') * 1000,
          strftime('%s', 'now') * 1000
        );

        -- Create index for quick lookup
        CREATE INDEX IF NOT EXISTS idx_servers_is_default ON servers(is_default);
      `
    },
    {
      name: '004_proxy_support',
      sql: `
        -- Add proxy support to gateway_config table
        ALTER TABLE gateway_config ADD COLUMN proxy_url TEXT;
        ALTER TABLE gateway_config ADD COLUMN proxy_username TEXT;
        ALTER TABLE gateway_config ADD COLUMN proxy_password TEXT;

        -- Add proxy support to servers table (for Gateway mode connections)
        ALTER TABLE servers ADD COLUMN proxy_url TEXT;
        ALTER TABLE servers ADD COLUMN proxy_username TEXT;
        ALTER TABLE servers ADD COLUMN proxy_password TEXT;
      `
    },
    {
      name: '005_messages_fts',
      sql: `
        -- FTS5 virtual table for full-text search on messages
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          session_id UNINDEXED,
          role UNINDEXED
        );

        -- Populate FTS from existing messages
        INSERT INTO messages_fts(rowid, content, session_id, role)
          SELECT rowid, content, session_id, role FROM messages;

        -- Trigger: keep FTS in sync on INSERT
        CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;

        -- Trigger: keep FTS in sync on DELETE
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
            VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.role);
        END;

        -- Trigger: keep FTS in sync on UPDATE
        CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
            VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.role);
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;
      `
    },
    {
      name: '006_register_as_backend',
      sql: `
        -- Add register_as_backend column to gateway_config table
        ALTER TABLE gateway_config ADD COLUMN register_as_backend INTEGER NOT NULL DEFAULT 1;
      `
    },
    {
      name: '007_search_history',
      sql: `
        -- search_history 表 (用户搜索历史记录)
        CREATE TABLE IF NOT EXISTS search_history (
          id TEXT PRIMARY KEY,
          user_id TEXT DEFAULT 'default',
          query TEXT NOT NULL,
          result_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        -- Create index for efficient lookups
        CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history(created_at DESC);
      `
    },
    {
      name: '008_extended_search',
      sql: `
        -- Create helper tables to store extracted metadata for FTS
        CREATE TABLE IF NOT EXISTS file_references (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_rowid INTEGER NOT NULL,
          message_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          source_type TEXT NOT NULL, -- 'tool_call' or 'attachment'
          created_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tool_call_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_rowid INTEGER NOT NULL,
          message_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          tool_input TEXT,
          tool_result TEXT,
          is_error INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        -- FTS5 virtual tables for files and tool calls
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
          file_path,
          source_type UNINDEXED,
          session_id UNINDEXED,
          message_id UNINDEXED,
          content=file_references,
          content_rowid=id
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS tool_calls_fts USING fts5(
          tool_name,
          tool_input,
          tool_result,
          session_id UNINDEXED,
          message_id UNINDEXED,
          content=tool_call_records,
          content_rowid=id
        );

        -- Triggers for file_references
        CREATE TRIGGER IF NOT EXISTS file_references_fts_insert AFTER INSERT ON file_references BEGIN
          INSERT INTO files_fts(rowid, file_path, source_type, session_id, message_id)
            VALUES (NEW.id, NEW.file_path, NEW.source_type, NEW.session_id, NEW.message_id);
        END;

        CREATE TRIGGER IF NOT EXISTS file_references_fts_delete AFTER DELETE ON file_references BEGIN
          INSERT INTO files_fts(files_fts, rowid, file_path, source_type, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.file_path, OLD.source_type, OLD.session_id, OLD.message_id);
        END;

        CREATE TRIGGER IF NOT EXISTS file_references_fts_update AFTER UPDATE ON file_references BEGIN
          INSERT INTO files_fts(files_fts, rowid, file_path, source_type, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.file_path, OLD.source_type, OLD.session_id, OLD.message_id);
          INSERT INTO files_fts(rowid, file_path, source_type, session_id, message_id)
            VALUES (NEW.id, NEW.file_path, NEW.source_type, NEW.session_id, NEW.message_id);
        END;

        -- Triggers for tool_call_records
        CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_insert AFTER INSERT ON tool_call_records BEGIN
          INSERT INTO tool_calls_fts(rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES (NEW.id, NEW.tool_name, NEW.tool_input, NEW.tool_result, NEW.session_id, NEW.message_id);
        END;

        CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_delete AFTER DELETE ON tool_call_records BEGIN
          INSERT INTO tool_calls_fts(tool_calls_fts, rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.tool_name, OLD.tool_input, OLD.tool_result, OLD.session_id, OLD.message_id);
        END;

        CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_update AFTER UPDATE ON tool_call_records BEGIN
          INSERT INTO tool_calls_fts(tool_calls_fts, rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.tool_name, OLD.tool_input, OLD.tool_result, OLD.session_id, OLD.message_id);
          INSERT INTO tool_calls_fts(rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES (NEW.id, NEW.tool_name, NEW.tool_input, NEW.tool_result, NEW.session_id, NEW.message_id);
        END;

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_file_references_message ON file_references(message_id);
        CREATE INDEX IF NOT EXISTS idx_file_references_session ON file_references(session_id);
        CREATE INDEX IF NOT EXISTS idx_tool_call_records_message ON tool_call_records(message_id);
        CREATE INDEX IF NOT EXISTS idx_tool_call_records_session ON tool_call_records(session_id);
      `
    }
  ];

  const appliedMigrations = new Set(
    (db.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((row) => row.name)
  );

  for (const migration of migrations) {
    if (!appliedMigrations.has(migration.name)) {
      console.log(`Applying migration: ${migration.name}`);
      db.exec(migration.sql);
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
  }
}

export type { Database };
