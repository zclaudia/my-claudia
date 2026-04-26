import type { Migration } from './types.js';

export const migration: Migration = {
  name: '024_session_working_directory',
  sql: `
        -- Add session-level working directory override for worktree support
        ALTER TABLE sessions ADD COLUMN working_directory TEXT;
        CREATE INDEX IF NOT EXISTS idx_sessions_working_directory ON sessions(working_directory);
      `,
};
