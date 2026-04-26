import type { Migration } from './types.js';

export const migration: Migration = {
  name: '041_app_config',
  sql: `
        CREATE TABLE IF NOT EXISTS app_config (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `,
};
