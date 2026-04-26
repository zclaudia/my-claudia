import type { Migration } from './types.js';

export const migration: Migration = {
  name: '048_agent_trigger_schedule_fields',
  idempotent: true,
  sql: `
        ALTER TABLE agent_triggers ADD COLUMN schedule_type TEXT;
        ALTER TABLE agent_triggers ADD COLUMN schedule_cron TEXT;
        ALTER TABLE agent_triggers ADD COLUMN schedule_interval_minutes INTEGER;
      `,
};
