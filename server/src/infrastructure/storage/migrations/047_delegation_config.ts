import type { Migration } from './types.js';

export const migration: Migration = {
  name: '047_delegation_config',
  sql: `
        CREATE TABLE IF NOT EXISTS delegation_config (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          config TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO delegation_config (id, config, created_at, updated_at)
        VALUES (1, '{"enabled":false,"confidenceThreshold":0.8,"maxAutoApprovalsPerMinute":10,"allowedCategories":["fileRead","fileWrite","shellSafe"],"neverDelegate":["AskUserQuestion","ExitPlanMode"]}', strftime('%s','now') * 1000, strftime('%s','now') * 1000);
      `,
};
