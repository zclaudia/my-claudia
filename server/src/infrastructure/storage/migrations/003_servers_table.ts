import type { Migration } from './types.js';

export const migration: Migration = {
  name: '003_servers_table',
  sql: `
        -- servers 表 (Client 连接的 Server/Backend 配置)
        CREATE TABLE IF NOT EXISTS servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          address TEXT NOT NULL,
          connection_mode TEXT CHECK(connection_mode IN ('direct', 'gateway')) DEFAULT 'direct',

          -- Gateway mode fields
          gateway_url TEXT,
          gateway_secret TEXT,
          backend_id TEXT,

          -- Common fields
          api_key TEXT,
          client_id TEXT,
          is_default INTEGER DEFAULT 0,
          requires_auth INTEGER DEFAULT 0,

          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          last_connected INTEGER
        );

        -- 插入默认的 local server
        INSERT OR IGNORE INTO servers (
          id, name, address, connection_mode, is_default, requires_auth,
          created_at, updated_at
        ) VALUES (
          'local',
          'Local Server',
          'localhost:3100',
          'direct',
          1,
          0,
          strftime('%s', 'now') * 1000,
          strftime('%s', 'now') * 1000
        );

        -- Create index for quick lookup
        CREATE INDEX IF NOT EXISTS idx_servers_is_default ON servers(is_default);
      `,
};
