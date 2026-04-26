import type { Migration } from './types.js';

export const migration: Migration = {
  name: '052_claudia_host_project',
  sql: `
        UPDATE projects
        SET name = '__claudia', type = 'chat_only', is_internal = 1, updated_at = strftime('%s','now')*1000
        WHERE name = '_Agent Assistant';

        UPDATE projects
        SET is_internal = 1, type = 'chat_only', updated_at = strftime('%s','now')*1000
        WHERE id = (SELECT project_id FROM agent_config WHERE id = 1 AND project_id IS NOT NULL);

        UPDATE sessions
        SET name = 'Claudia Chat', updated_at = strftime('%s','now')*1000
        WHERE project_id = (SELECT project_id FROM agent_config WHERE id = 1 AND project_id IS NOT NULL)
          AND name = 'Agent Chat';
      `,
};
