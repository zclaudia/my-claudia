import type { Migration } from './types.js';

export const migration: Migration = {
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
      `,
};
