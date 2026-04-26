import type { Migration } from './types.js';

export const migration: Migration = {
  name: '045_agent_assistant_memory',
  sql: `
        -- Layer 1: Activity log (append-only journal of agent actions)
        CREATE TABLE IF NOT EXISTS agent_activity_log (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
          type TEXT NOT NULL,
          summary TEXT NOT NULL,
          metadata TEXT,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_agent_activity_log_project ON agent_activity_log(project_id);
        CREATE INDEX IF NOT EXISTS idx_agent_activity_log_created ON agent_activity_log(created_at);

        -- Layer 2: Derived knowledge (project-scoped + global)
        CREATE TABLE IF NOT EXISTS agent_memory (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          namespace TEXT NOT NULL DEFAULT 'default',
          key TEXT NOT NULL,
          value TEXT NOT NULL,
          source_task_id TEXT,
          source_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
          author_scope TEXT NOT NULL DEFAULT 'project',
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(project_id, namespace, key)
        );
        CREATE INDEX IF NOT EXISTS idx_agent_memory_project ON agent_memory(project_id);
        CREATE INDEX IF NOT EXISTS idx_agent_memory_namespace ON agent_memory(namespace);
      `,
};
