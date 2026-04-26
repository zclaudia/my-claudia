import type { Migration } from './types.js';

export const migration: Migration = {
  name: '004_proxy_support',
  sql: `
        -- Add proxy support to gateway_config table
        ALTER TABLE gateway_config ADD COLUMN proxy_url TEXT;
        ALTER TABLE gateway_config ADD COLUMN proxy_username TEXT;
        ALTER TABLE gateway_config ADD COLUMN proxy_password TEXT;

        -- Add proxy support to servers table (for Gateway mode connections)
        ALTER TABLE servers ADD COLUMN proxy_url TEXT;
        ALTER TABLE servers ADD COLUMN proxy_username TEXT;
        ALTER TABLE servers ADD COLUMN proxy_password TEXT;
      `,
};
