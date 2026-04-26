import type { Migration } from './types.js';

export const migration: Migration = {
  name: '046_agent_feed',
  sql: `
        CREATE TABLE IF NOT EXISTS agent_feed (
          id TEXT PRIMARY KEY,
          trigger_id TEXT,
          task_id TEXT,
          session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          source TEXT NOT NULL CHECK(source IN ('trigger', 'scheduled', 'manual', 'delegation')),
          title TEXT NOT NULL,
          summary TEXT,
          status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'completed', 'failed')),
          error TEXT,
          delegation_context TEXT,
          created_at INTEGER NOT NULL,
          completed_at INTEGER,
          read_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_agent_feed_created ON agent_feed(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_agent_feed_status ON agent_feed(status);
        CREATE INDEX IF NOT EXISTS idx_agent_feed_read ON agent_feed(read_at);

        CREATE TABLE IF NOT EXISTS agent_triggers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          description TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          trigger_type TEXT NOT NULL CHECK(trigger_type IN ('event', 'schedule', 'both')),
          event_pattern TEXT,
          event_filter TEXT,
          prompt_template TEXT NOT NULL,
          provider_id TEXT,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          context_template TEXT DEFAULT 'agent',
          feed_delivery INTEGER NOT NULL DEFAULT 1,
          notify_delivery INTEGER NOT NULL DEFAULT 0,
          source_plugin_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_triggers_enabled ON agent_triggers(enabled);
      `,
};
