import type { Migration } from './types.js';

export const migration: Migration = {
  name: '051_permission_outside_workspace_roots',
  sql: `
        CREATE TABLE IF NOT EXISTS permission_outside_workspace_roots (
          project_id TEXT NOT NULL,
          allowed_root TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (project_id, allowed_root),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_permission_outside_workspace_roots_project_id
          ON permission_outside_workspace_roots(project_id);
      `,
};
