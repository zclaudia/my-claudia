import type { Migration } from './types.js';

export const migration: Migration = {
  name: '016_project_is_internal',
  sql: `
        ALTER TABLE projects ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;
        UPDATE projects SET is_internal = 1 WHERE name = '_Agent Assistant';
      `,
};
