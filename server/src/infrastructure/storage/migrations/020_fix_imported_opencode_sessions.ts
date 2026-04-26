import type { Migration } from './types.js';

export const migration: Migration = {
  name: '020_fix_imported_opencode_sessions',
  sql: `
        -- Fix imported OpenCode sessions that lack provider_id.
        -- Set provider_id to the OpenCode provider for sessions without one,
        -- where the project has an OpenCode provider set.
        UPDATE sessions
        SET provider_id = (
          SELECT p.provider_id FROM projects p
          WHERE p.id = sessions.project_id
            AND p.provider_id IN (SELECT id FROM providers WHERE type = 'opencode')
        )
        WHERE provider_id IS NULL
          AND EXISTS (
            SELECT 1 FROM projects p
            WHERE p.id = sessions.project_id
              AND p.provider_id IN (SELECT id FROM providers WHERE type = 'opencode')
          );
      `,
};
