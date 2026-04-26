import type { Migration } from './types.js';

export const migration: Migration = {
  name: '043_session_type_agent',
  sql: `
        -- SQLite doesn't support ALTER CHECK constraint, so recreate the table
        -- with the updated CHECK that includes 'agent' type.
        -- Disable FK enforcement during table rebuild to prevent SQLITE_LOCKED
        PRAGMA foreign_keys = OFF;
        -- Drop residual temp table from prior failed migration attempts
        DROP TABLE IF EXISTS sessions_new;
        CREATE TABLE sessions_new AS SELECT * FROM sessions;
        DROP TABLE sessions;
        CREATE TABLE sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT,
          provider_id TEXT,
          sdk_session_id TEXT,
          type TEXT CHECK(type IN ('regular', 'background', 'agent')) DEFAULT 'regular',
          parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          working_directory TEXT,
          project_role TEXT,
          task_id TEXT,
          plan_status TEXT,
          is_read_only INTEGER DEFAULT 0,
          last_run_status TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          archived_at INTEGER
        );
        INSERT INTO sessions (id, project_id, name, provider_id, sdk_session_id, type, parent_session_id, working_directory, project_role, task_id, plan_status, is_read_only, last_run_status, created_at, updated_at, archived_at)
          SELECT id, project_id, name, provider_id, sdk_session_id, COALESCE(type, 'regular'), parent_session_id, working_directory, project_role, task_id, plan_status, is_read_only, last_run_status, created_at, updated_at, archived_at FROM sessions_new;
        DROP TABLE sessions_new;
        CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived_at);
        PRAGMA foreign_keys = ON;
      `,
};
