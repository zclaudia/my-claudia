import type { Migration } from './types.js';

export const migration: Migration = {
  name: '060_managed_processes',
  sql: `
        CREATE TABLE IF NOT EXISTS managed_processes (
          process_id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          status TEXT NOT NULL,
          pid INTEGER,
          ppid INTEGER,
          root_pid INTEGER,
          pgid INTEGER,
          command TEXT NOT NULL,
          args_json TEXT NOT NULL,
          cwd TEXT,
          owner_session_id TEXT,
          owner_task_id TEXT,
          owner_backend_id TEXT,
          owner_run_id TEXT,
          owner_request_id TEXT,
          parent_process_id TEXT,
          started_at INTEGER NOT NULL,
          exited_at INTEGER,
          exit_code INTEGER,
          signal TEXT,
          protected INTEGER NOT NULL DEFAULT 0,
          tags_json TEXT NOT NULL,
          adopted INTEGER NOT NULL DEFAULT 0,
          orphaned_at INTEGER,
          metadata_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_managed_processes_status ON managed_processes(status);
        CREATE INDEX IF NOT EXISTS idx_managed_processes_source ON managed_processes(source);
        CREATE INDEX IF NOT EXISTS idx_managed_processes_exited_at ON managed_processes(exited_at);
      `,
};
