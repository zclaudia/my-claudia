import type { Migration } from './types.js';

export const migration: Migration = {
  name: '067_turn_summaries',
  sql: `
    CREATE TABLE IF NOT EXISTS turn_summaries (
      session_id       TEXT NOT NULL,
      user_message_id  TEXT NOT NULL,
      as_of_message_id TEXT NOT NULL,
      goal             TEXT NOT NULL,
      solved           TEXT NOT NULL,
      open_issues      TEXT NOT NULL,
      model            TEXT NOT NULL,
      generated_at     INTEGER NOT NULL,
      PRIMARY KEY (session_id, user_message_id),
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_turn_summaries_session
      ON turn_summaries(session_id);
  `,
};
