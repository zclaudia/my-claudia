import type { Migration } from './types.js';

export const migration: Migration = {
  name: '002_gateway_config',
  sql: `
        -- gateway_config 表 (Server 连接到 Gateway 的配置)
        CREATE TABLE IF NOT EXISTS gateway_config (
          id INTEGER PRIMARY KEY CHECK(id = 1), -- 单例配置
          enabled INTEGER NOT NULL DEFAULT 0,
          gateway_url TEXT,
          gateway_secret TEXT,
          backend_name TEXT,
          backend_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- 插入默认配置
        INSERT OR IGNORE INTO gateway_config (id, enabled, created_at, updated_at)
        VALUES (1, 0, strftime('%s', 'now') * 1000, strftime('%s', 'now') * 1000);
      `,
};
