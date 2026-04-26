import type { Migration } from './types.js';

export const migration: Migration = {
  name: '006_register_as_backend',
  sql: `
        -- Add register_as_backend column to gateway_config table
        ALTER TABLE gateway_config ADD COLUMN register_as_backend INTEGER NOT NULL DEFAULT 1;
      `,
};
