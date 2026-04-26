import type { Migration } from './types.js';

export const migration: Migration = {
  name: '031_scheduled_tasks',
  sql: `
        CREATE TABLE IF NOT EXISTS scheduled_tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          schedule_type TEXT NOT NULL CHECK (schedule_type IN ('cron', 'interval', 'once')),
          schedule_cron TEXT,
          schedule_interval_minutes INTEGER,
          schedule_once_at INTEGER,
          next_run INTEGER,
          action_type TEXT NOT NULL CHECK (action_type IN ('prompt', 'command', 'shell', 'webhook', 'plugin_event')),
          action_config TEXT NOT NULL DEFAULT '{}',
          status TEXT NOT NULL DEFAULT 'idle' CHECK (status IN ('idle', 'running', 'error')),
          last_run_at INTEGER,
          last_run_result TEXT,
          last_error TEXT,
          run_count INTEGER NOT NULL DEFAULT 0,
          template_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_project ON scheduled_tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_enabled_next ON scheduled_tasks(enabled, next_run);
      `,
};
