import type { Migration } from './types.js';

export const migration: Migration = {
  name: '019_notification_config',
  sql: `
        CREATE TABLE IF NOT EXISTS notification_config (
          id TEXT PRIMARY KEY DEFAULT 'default',
          config TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `,
};
