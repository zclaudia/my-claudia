import type { Migration } from './types.js';

export const migration: Migration = {
  name: '018_supervisions',
  sql: `
        CREATE TABLE IF NOT EXISTS supervisions (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          goal TEXT NOT NULL,
          subtasks TEXT,
          status TEXT CHECK(status IN ('active', 'paused', 'completed', 'failed', 'cancelled')) NOT NULL DEFAULT 'active',
          max_iterations INTEGER NOT NULL DEFAULT 10,
          current_iteration INTEGER NOT NULL DEFAULT 0,
          cooldown_seconds INTEGER NOT NULL DEFAULT 5,
          last_run_id TEXT,
          error_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_supervisions_session_id ON supervisions(session_id);
        CREATE INDEX IF NOT EXISTS idx_supervisions_status ON supervisions(status);

        CREATE TABLE IF NOT EXISTS supervision_logs (
          id TEXT PRIMARY KEY,
          supervision_id TEXT NOT NULL,
          iteration INTEGER,
          event TEXT NOT NULL,
          detail TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (supervision_id) REFERENCES supervisions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_supervision_logs_supervision_id ON supervision_logs(supervision_id);
      `,
};
