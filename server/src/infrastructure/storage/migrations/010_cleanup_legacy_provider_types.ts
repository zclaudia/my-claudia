import type { Migration } from './types.js';

export const migration: Migration = {
  name: '010_cleanup_legacy_provider_types',
  sql: `
        -- Migrate any legacy provider types to 'claude'
        UPDATE providers SET type = 'claude' WHERE type NOT IN ('claude', 'openclaude', 'opencode', 'codex', 'cursor', 'kimi');
      `,
};
