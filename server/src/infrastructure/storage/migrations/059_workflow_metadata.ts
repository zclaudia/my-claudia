import type { Migration } from './types.js';

export const migration: Migration = {
  name: '059_workflow_metadata',
  sql: `
        ALTER TABLE workflows ADD COLUMN source_plugin_id TEXT;
        ALTER TABLE workflows ADD COLUMN source_type TEXT DEFAULT 'user';
        ALTER TABLE workflows ADD COLUMN authoring_mode TEXT DEFAULT 'graph';
      `,
};
