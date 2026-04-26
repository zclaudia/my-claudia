import type { Migration } from './types.js';

export const migration: Migration = {
  name: '057_sort_order',
  sql: `
        ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE sessions ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

        -- Backfill projects: assign sort_order by updated_at DESC (most recent = 0)
        UPDATE projects SET sort_order = (
          SELECT COUNT(*) FROM projects p2 WHERE p2.updated_at > projects.updated_at
        );
        -- Backfill sessions: assign sort_order per project by updated_at DESC
        UPDATE sessions SET sort_order = (
          SELECT COUNT(*) FROM sessions s2
          WHERE s2.project_id = sessions.project_id AND s2.updated_at > sessions.updated_at
        );
      `,
};
