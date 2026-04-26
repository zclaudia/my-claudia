import type { Migration } from './types.js';

export const migration: Migration = {
  name: '023_message_offset',
  sql: `
        -- Add per-session sequential offset to messages for gap detection
        ALTER TABLE messages ADD COLUMN offset INTEGER;

        -- Backfill existing messages with offset based on created_at order within each session
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at) as rn
          FROM messages
        )
        UPDATE messages SET offset = (
          SELECT rn FROM ranked WHERE ranked.id = messages.id
        );

        -- Index for efficient offset-based queries
        CREATE INDEX IF NOT EXISTS idx_messages_session_offset
          ON messages(session_id, offset);
      `,
};
