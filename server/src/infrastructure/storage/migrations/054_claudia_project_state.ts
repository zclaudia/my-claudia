import type { Migration } from './types.js';

export const migration: Migration = {
  name: '054_claudia_project_state',
  sql: `
        CREATE TABLE IF NOT EXISTS claudia_project_state (
          host_project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
          active_branch_id TEXT REFERENCES claudia_branches(id) ON DELETE SET NULL,
          updated_at INTEGER NOT NULL
        );
      `,
};
