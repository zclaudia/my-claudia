import type { Migration } from './types.js';

export const migration: Migration = {
  name: '063_notification_initiator',
  sql: `
        ALTER TABLE notifications ADD COLUMN initiator TEXT;
      `,
};
