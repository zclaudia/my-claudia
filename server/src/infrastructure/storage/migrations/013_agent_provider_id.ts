import type { Migration } from './types.js';

export const migration: Migration = {
  name: '013_agent_provider_id',
  sql: `
        ALTER TABLE agent_config ADD COLUMN provider_id TEXT;
      `,
};
