import type { Migration } from './types.js';

export const migration: Migration = {
  name: '022_supervision_planning',
  sql: `
        -- Recreate supervisions table with 'planning' status and new columns
        CREATE TABLE IF NOT EXISTS supervisions_new (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          goal TEXT NOT NULL,
          subtasks TEXT,
          status TEXT CHECK(status IN ('planning', 'active', 'paused', 'completed', 'failed', 'cancelled')) NOT NULL DEFAULT 'active',
          max_iterations INTEGER NOT NULL DEFAULT 10,
          current_iteration INTEGER NOT NULL DEFAULT 0,
          cooldown_seconds INTEGER NOT NULL DEFAULT 5,
          last_run_id TEXT,
          error_message TEXT,
          plan_session_id TEXT,
          acceptance_criteria TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (plan_session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        INSERT INTO supervisions_new (id, session_id, goal, subtasks, status, max_iterations, current_iteration, cooldown_seconds, last_run_id, error_message, created_at, updated_at, completed_at)
        SELECT id, session_id, goal, subtasks, status, max_iterations, current_iteration, cooldown_seconds, last_run_id, error_message, created_at, updated_at, completed_at
        FROM supervisions;

        DROP TABLE IF EXISTS supervisions;
        ALTER TABLE supervisions_new RENAME TO supervisions;

        CREATE INDEX IF NOT EXISTS idx_supervisions_session_id ON supervisions(session_id);
        CREATE INDEX IF NOT EXISTS idx_supervisions_status ON supervisions(status);
      `,
};
