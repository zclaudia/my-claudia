import type { Migration } from './types.js';

export const migration: Migration = {
  name: '028_lite_supervisor_scheduling',
  sql: `
        ALTER TABLE supervision_tasks ADD COLUMN schedule_cron TEXT;
        ALTER TABLE supervision_tasks ADD COLUMN schedule_next_run INTEGER;
        ALTER TABLE supervision_tasks ADD COLUMN schedule_enabled INTEGER DEFAULT 0;
        ALTER TABLE supervision_tasks ADD COLUMN retry_delay_ms INTEGER DEFAULT 5000;

        CREATE INDEX IF NOT EXISTS idx_supervision_tasks_schedule
          ON supervision_tasks(schedule_enabled, schedule_next_run);
      `,
};
