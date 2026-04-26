import type { Migration } from './types.js';

export const migration: Migration = {
  name: '007_search_history',
  sql: `
        -- search_history 表 (用户搜索历史记录)
        CREATE TABLE IF NOT EXISTS search_history (
          id TEXT PRIMARY KEY,
          user_id TEXT DEFAULT 'default',
          query TEXT NOT NULL,
          result_count INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL
        );

        -- Create index for efficient lookups
        CREATE INDEX IF NOT EXISTS idx_search_history_user_id ON search_history(user_id, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history(created_at DESC);
      `,
};
