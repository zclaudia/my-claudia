import type { Migration } from './types.js';

export const migration: Migration = {
  name: '058_rename_agent_feed_to_notifications',
  sql: `
        ALTER TABLE agent_feed RENAME TO notifications;
        DROP INDEX IF EXISTS idx_agent_feed_created;
        DROP INDEX IF EXISTS idx_agent_feed_status;
        DROP INDEX IF EXISTS idx_agent_feed_read;
        CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
        CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(read_at);
      `,
};
