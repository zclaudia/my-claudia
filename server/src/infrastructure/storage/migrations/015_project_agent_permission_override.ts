import type { Migration } from './types.js';

export const migration: Migration = {
  name: '015_project_agent_permission_override',
  sql: `
        ALTER TABLE projects ADD COLUMN agent_permission_override TEXT;
      `,
};
