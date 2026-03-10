import Database from 'better-sqlite3';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { reindexAllMessages } from './metadata-extractor.js';

const DB_DIR = process.env.MY_CLAUDIA_DATA_DIR
  ? path.resolve(process.env.MY_CLAUDIA_DATA_DIR)
  : path.join(os.homedir(), '.my-claudia');
const DB_PATH = path.join(DB_DIR, 'data.db');

export function initDatabase(): Database.Database {
  // Ensure directory exists
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const db = new Database(DB_PATH);

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Run migrations
  runMigrations(db);

  return db;
}

function runMigrations(db: Database.Database): void {
  // Create migrations table if not exists
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at INTEGER NOT NULL
    )
  `);

  const migrations: Array<{ name: string; sql: string }> = [
    {
      name: '001_initial_schema',
      sql: `
        -- providers 表 (用户配置的多 Provider)
        CREATE TABLE IF NOT EXISTS providers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'claude',
          cli_path TEXT,
          env TEXT,
          is_default INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        -- projects 表
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          type TEXT CHECK(type IN ('chat_only', 'code')) DEFAULT 'code',
          provider_id TEXT,
          root_path TEXT,
          system_prompt TEXT,
          permission_policy TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
        );

        -- sessions 表
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT,
          provider_id TEXT,
          sdk_session_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (provider_id) REFERENCES providers(id) ON DELETE SET NULL
        );

        -- messages 表
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
          content TEXT NOT NULL,
          metadata TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        -- permission_logs 表
        CREATE TABLE IF NOT EXISTS permission_logs (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          tool TEXT NOT NULL,
          detail TEXT NOT NULL,
          decision TEXT CHECK(decision IN ('allow', 'deny', 'timeout')) NOT NULL,
          remembered INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_sessions_project_id ON sessions(project_id);
        CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id);
        CREATE INDEX IF NOT EXISTS idx_permission_logs_session_id ON permission_logs(session_id);
      `
    },
    {
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
      `
    },
    {
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
      `
    },
    {
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
      `
    },
    {
      name: '005_messages_fts',
      sql: `
        -- FTS5 virtual table for full-text search on messages
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
          content,
          session_id UNINDEXED,
          role UNINDEXED
        );

        -- Populate FTS from existing messages
        INSERT INTO messages_fts(rowid, content, session_id, role)
          SELECT rowid, content, session_id, role FROM messages;

        -- Trigger: keep FTS in sync on INSERT
        CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;

        -- Trigger: keep FTS in sync on DELETE
        CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
            VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.role);
        END;

        -- Trigger: keep FTS in sync on UPDATE
        CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE ON messages BEGIN
          INSERT INTO messages_fts(messages_fts, rowid, content, session_id, role)
            VALUES ('delete', OLD.rowid, OLD.content, OLD.session_id, OLD.role);
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;
      `
    },
    {
      name: '006_register_as_backend',
      sql: `
        -- Add register_as_backend column to gateway_config table
        ALTER TABLE gateway_config ADD COLUMN register_as_backend INTEGER NOT NULL DEFAULT 1;
      `
    },
    {
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
      `
    },
    {
      name: '008_extended_search',
      sql: `
        -- Create helper tables to store extracted metadata for FTS
        CREATE TABLE IF NOT EXISTS file_references (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_rowid INTEGER NOT NULL,
          message_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          file_path TEXT NOT NULL,
          source_type TEXT NOT NULL, -- 'tool_call' or 'attachment'
          created_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS tool_call_records (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          message_rowid INTEGER NOT NULL,
          message_id TEXT NOT NULL,
          session_id TEXT NOT NULL,
          tool_name TEXT NOT NULL,
          tool_input TEXT,
          tool_result TEXT,
          is_error INTEGER DEFAULT 0,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
        );

        -- FTS5 virtual tables for files and tool calls
        CREATE VIRTUAL TABLE IF NOT EXISTS files_fts USING fts5(
          file_path,
          source_type UNINDEXED,
          session_id UNINDEXED,
          message_id UNINDEXED,
          content=file_references,
          content_rowid=id
        );

        CREATE VIRTUAL TABLE IF NOT EXISTS tool_calls_fts USING fts5(
          tool_name,
          tool_input,
          tool_result,
          session_id UNINDEXED,
          message_id UNINDEXED,
          content=tool_call_records,
          content_rowid=id
        );

        -- Triggers for file_references
        CREATE TRIGGER IF NOT EXISTS file_references_fts_insert AFTER INSERT ON file_references BEGIN
          INSERT INTO files_fts(rowid, file_path, source_type, session_id, message_id)
            VALUES (NEW.id, NEW.file_path, NEW.source_type, NEW.session_id, NEW.message_id);
        END;

        CREATE TRIGGER IF NOT EXISTS file_references_fts_delete AFTER DELETE ON file_references BEGIN
          INSERT INTO files_fts(files_fts, rowid, file_path, source_type, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.file_path, OLD.source_type, OLD.session_id, OLD.message_id);
        END;

        CREATE TRIGGER IF NOT EXISTS file_references_fts_update AFTER UPDATE ON file_references BEGIN
          INSERT INTO files_fts(files_fts, rowid, file_path, source_type, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.file_path, OLD.source_type, OLD.session_id, OLD.message_id);
          INSERT INTO files_fts(rowid, file_path, source_type, session_id, message_id)
            VALUES (NEW.id, NEW.file_path, NEW.source_type, NEW.session_id, NEW.message_id);
        END;

        -- Triggers for tool_call_records
        CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_insert AFTER INSERT ON tool_call_records BEGIN
          INSERT INTO tool_calls_fts(rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES (NEW.id, NEW.tool_name, NEW.tool_input, NEW.tool_result, NEW.session_id, NEW.message_id);
        END;

        CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_delete AFTER DELETE ON tool_call_records BEGIN
          INSERT INTO tool_calls_fts(tool_calls_fts, rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.tool_name, OLD.tool_input, OLD.tool_result, OLD.session_id, OLD.message_id);
        END;

        CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_update AFTER UPDATE ON tool_call_records BEGIN
          INSERT INTO tool_calls_fts(tool_calls_fts, rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES ('delete', OLD.id, OLD.tool_name, OLD.tool_input, OLD.tool_result, OLD.session_id, OLD.message_id);
          INSERT INTO tool_calls_fts(rowid, tool_name, tool_input, tool_result, session_id, message_id)
            VALUES (NEW.id, NEW.tool_name, NEW.tool_input, NEW.tool_result, NEW.session_id, NEW.message_id);
        END;

        -- Create indexes
        CREATE INDEX IF NOT EXISTS idx_file_references_message ON file_references(message_id);
        CREATE INDEX IF NOT EXISTS idx_file_references_session ON file_references(session_id);
        CREATE INDEX IF NOT EXISTS idx_tool_call_records_message ON tool_call_records(message_id);
        CREATE INDEX IF NOT EXISTS idx_tool_call_records_session ON tool_call_records(session_id);
      `
    },
    {
      name: '009_fix_messages_fts_triggers',
      sql: `
        -- Fix messages_fts triggers: SQLite 3.49+ broke the special 'delete' command
        -- for regular (non-content-synced) FTS5 tables. Use standard DELETE instead.

        DROP TRIGGER IF EXISTS messages_fts_delete;
        CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
          DELETE FROM messages_fts WHERE rowid = OLD.rowid;
        END;

        DROP TRIGGER IF EXISTS messages_fts_update;
        CREATE TRIGGER messages_fts_update AFTER UPDATE ON messages BEGIN
          DELETE FROM messages_fts WHERE rowid = OLD.rowid;
          INSERT INTO messages_fts(rowid, content, session_id, role)
            VALUES (NEW.rowid, NEW.content, NEW.session_id, NEW.role);
        END;
      `
    },
    {
      name: '010_cleanup_legacy_provider_types',
      sql: `
        -- Migrate any legacy provider types to 'claude'
        UPDATE providers SET type = 'claude' WHERE type NOT IN ('claude', 'opencode');
      `
    },
    {
      name: '011_fix_orphaned_fts_rows',
      sql: `
        -- Clean up orphaned FTS rows left by the broken delete trigger (pre-009).
        -- The old trigger used the FTS5 'delete' command which stopped working in
        -- SQLite 3.49+, leaving FTS rows behind when messages were deleted.
        DELETE FROM messages_fts WHERE rowid NOT IN (SELECT rowid FROM messages);
      `
    },
    {
      name: '012_agent_config',
      sql: `
        -- agent_config: singleton table for agent assistant settings
        CREATE TABLE IF NOT EXISTS agent_config (
          id INTEGER PRIMARY KEY CHECK(id = 1),
          enabled INTEGER NOT NULL DEFAULT 1,
          project_id TEXT,
          session_id TEXT,
          permission_policy TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO agent_config (id, enabled, created_at, updated_at)
        VALUES (1, 1, strftime('%s','now')*1000, strftime('%s','now')*1000);
      `
    },
    {
      name: '013_agent_provider_id',
      sql: `
        ALTER TABLE agent_config ADD COLUMN provider_id TEXT;
      `
    },
    {
      name: '014_session_type_and_parent',
      sql: `
        ALTER TABLE sessions ADD COLUMN type TEXT CHECK(type IN ('regular', 'background')) DEFAULT 'regular';
        ALTER TABLE sessions ADD COLUMN parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL;
      `
    },
    {
      name: '015_project_agent_permission_override',
      sql: `
        ALTER TABLE projects ADD COLUMN agent_permission_override TEXT;
      `
    },
    {
      name: '016_project_is_internal',
      sql: `
        ALTER TABLE projects ADD COLUMN is_internal INTEGER NOT NULL DEFAULT 0;
        UPDATE projects SET is_internal = 1 WHERE name = '_Agent Assistant';
      `
    },
    {
      name: '017_session_archived_at',
      sql: `ALTER TABLE sessions ADD COLUMN archived_at INTEGER;`
    },
    {
      name: '018_supervisions',
      sql: `
        CREATE TABLE IF NOT EXISTS supervisions (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          goal TEXT NOT NULL,
          subtasks TEXT,
          status TEXT CHECK(status IN ('active', 'paused', 'completed', 'failed', 'cancelled')) NOT NULL DEFAULT 'active',
          max_iterations INTEGER NOT NULL DEFAULT 10,
          current_iteration INTEGER NOT NULL DEFAULT 0,
          cooldown_seconds INTEGER NOT NULL DEFAULT 5,
          last_run_id TEXT,
          error_message TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_supervisions_session_id ON supervisions(session_id);
        CREATE INDEX IF NOT EXISTS idx_supervisions_status ON supervisions(status);

        CREATE TABLE IF NOT EXISTS supervision_logs (
          id TEXT PRIMARY KEY,
          supervision_id TEXT NOT NULL,
          iteration INTEGER,
          event TEXT NOT NULL,
          detail TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (supervision_id) REFERENCES supervisions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_supervision_logs_supervision_id ON supervision_logs(supervision_id);
      `
    },
    {
      name: '019_notification_config',
      sql: `
        CREATE TABLE IF NOT EXISTS notification_config (
          id TEXT PRIMARY KEY DEFAULT 'default',
          config TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `
    },
    {
      name: '020_fix_imported_opencode_sessions',
      sql: `
        -- Fix imported OpenCode sessions that lack provider_id.
        -- Set provider_id to the OpenCode provider for sessions without one,
        -- where the project has an OpenCode provider set.
        UPDATE sessions
        SET provider_id = (
          SELECT p.provider_id FROM projects p
          WHERE p.id = sessions.project_id
            AND p.provider_id IN (SELECT id FROM providers WHERE type = 'opencode')
        )
        WHERE provider_id IS NULL
          AND EXISTS (
            SELECT 1 FROM projects p
            WHERE p.id = sessions.project_id
              AND p.provider_id IN (SELECT id FROM providers WHERE type = 'opencode')
          );
      `
    },
    {
      name: '021_files_table',
      sql: `
        CREATE TABLE IF NOT EXISTS files (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          size INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `
    },
    {
      name: '022_supervision_planning',
      sql: `
        -- Recreate supervisions table with 'planning' status and new columns
        CREATE TABLE IF NOT EXISTS supervisions_new (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          goal TEXT NOT NULL,
          subtasks TEXT,
          status TEXT CHECK(status IN ('planning', 'active', 'paused', 'completed', 'failed', 'cancelled')) NOT NULL DEFAULT 'active',
          max_iterations INTEGER NOT NULL DEFAULT 10,
          current_iteration INTEGER NOT NULL DEFAULT 0,
          cooldown_seconds INTEGER NOT NULL DEFAULT 5,
          last_run_id TEXT,
          error_message TEXT,
          plan_session_id TEXT,
          acceptance_criteria TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          completed_at INTEGER,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
          FOREIGN KEY (plan_session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        INSERT INTO supervisions_new (id, session_id, goal, subtasks, status, max_iterations, current_iteration, cooldown_seconds, last_run_id, error_message, created_at, updated_at, completed_at)
        SELECT id, session_id, goal, subtasks, status, max_iterations, current_iteration, cooldown_seconds, last_run_id, error_message, created_at, updated_at, completed_at
        FROM supervisions;

        DROP TABLE IF EXISTS supervisions;
        ALTER TABLE supervisions_new RENAME TO supervisions;

        CREATE INDEX IF NOT EXISTS idx_supervisions_session_id ON supervisions(session_id);
        CREATE INDEX IF NOT EXISTS idx_supervisions_status ON supervisions(status);
      `
    },
    {
      name: '023_message_offset',
      sql: `
        -- Add per-session sequential offset to messages for gap detection
        ALTER TABLE messages ADD COLUMN offset INTEGER;

        -- Backfill existing messages with offset based on created_at order within each session
        WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY created_at) as rn
          FROM messages
        )
        UPDATE messages SET offset = (
          SELECT rn FROM ranked WHERE ranked.id = messages.id
        );

        -- Index for efficient offset-based queries
        CREATE INDEX IF NOT EXISTS idx_messages_session_offset
          ON messages(session_id, offset);
      `
    },
    {
      name: '024_session_working_directory',
      sql: `
        -- Add session-level working directory override for worktree support
        ALTER TABLE sessions ADD COLUMN working_directory TEXT;
        CREATE INDEX IF NOT EXISTS idx_sessions_working_directory ON sessions(working_directory);
      `
    },
    {
      name: '025_supervision_v2',
      sql: `
        -- supervision_tasks: v2 task management
        CREATE TABLE IF NOT EXISTS supervision_tasks (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'user' CHECK (source IN ('user', 'agent_discovered')),
          session_id TEXT,
          status TEXT NOT NULL,
          priority INTEGER NOT NULL DEFAULT 0,
          dependencies TEXT,
          dependency_mode TEXT DEFAULT 'all',
          relevant_doc_ids TEXT,
          task_specific_context TEXT,
          scope TEXT,
          acceptance_criteria TEXT,
          max_retries INTEGER DEFAULT 2,
          attempt INTEGER NOT NULL DEFAULT 1,
          base_commit TEXT,
          result TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          started_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
          FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE SET NULL
        );

        CREATE INDEX IF NOT EXISTS idx_supervision_tasks_project ON supervision_tasks(project_id);
        CREATE INDEX IF NOT EXISTS idx_supervision_tasks_status ON supervision_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_supervision_tasks_session ON supervision_tasks(session_id);

        -- supervision_v2_logs: structured event log
        CREATE TABLE IF NOT EXISTS supervision_v2_logs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          task_id TEXT,
          event TEXT NOT NULL,
          detail TEXT,
          created_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_sv2_logs_project ON supervision_v2_logs(project_id);
        CREATE INDEX IF NOT EXISTS idx_sv2_logs_task ON supervision_v2_logs(task_id);

        -- Extend projects table
        ALTER TABLE projects ADD COLUMN agent TEXT;
        ALTER TABLE projects ADD COLUMN context_sync_status TEXT NOT NULL DEFAULT 'synced';

        -- Extend sessions table
        ALTER TABLE sessions ADD COLUMN project_role TEXT;
        ALTER TABLE sessions ADD COLUMN task_id TEXT;
      `
    },
    {
      name: '026_deprecate_supervision_v1',
      sql: `
        ALTER TABLE supervisions RENAME TO supervisions_v1_archived;
        ALTER TABLE supervision_logs RENAME TO supervision_logs_v1_archived;
      `
    },
    {
      name: '027_session_plan_status',
      sql: `
        ALTER TABLE sessions ADD COLUMN plan_status TEXT;
        ALTER TABLE sessions ADD COLUMN is_read_only INTEGER DEFAULT 0;
      `
    },
    {
      name: '028_lite_supervisor_scheduling',
      sql: `
        ALTER TABLE supervision_tasks ADD COLUMN schedule_cron TEXT;
        ALTER TABLE supervision_tasks ADD COLUMN schedule_next_run INTEGER;
        ALTER TABLE supervision_tasks ADD COLUMN schedule_enabled INTEGER DEFAULT 0;
        ALTER TABLE supervision_tasks ADD COLUMN retry_delay_ms INTEGER DEFAULT 5000;

        CREATE INDEX IF NOT EXISTS idx_supervision_tasks_schedule
          ON supervision_tasks(schedule_enabled, schedule_next_run);
      `
    },
    {
      name: '029_mcp_servers',
      sql: `
        CREATE TABLE IF NOT EXISTS mcp_servers (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          command TEXT NOT NULL,
          args TEXT,
          env TEXT,
          enabled INTEGER NOT NULL DEFAULT 1,
          description TEXT,
          source TEXT NOT NULL DEFAULT 'user',
          provider_scope TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);
        CREATE INDEX IF NOT EXISTS idx_mcp_servers_name ON mcp_servers(name);
      `
    },
    {
      name: '030_local_pr_workflow',
      sql: `
        ALTER TABLE projects ADD COLUMN review_provider_id TEXT REFERENCES providers(id) ON DELETE SET NULL;

        CREATE TABLE IF NOT EXISTS local_prs (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          branch_name TEXT NOT NULL,
          base_branch TEXT NOT NULL DEFAULT 'master',
          title TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'open'
            CHECK (status IN ('open','reviewing','review_failed','approved','merging','merged','conflict','closed')),
          commits TEXT,
          diff_summary TEXT,
          review_session_id TEXT,
          conflict_session_id TEXT,
          review_notes TEXT,
          status_message TEXT,
          auto_triggered INTEGER NOT NULL DEFAULT 0,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          merged_at INTEGER,
          merged_commit_sha TEXT,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_local_prs_project ON local_prs(project_id);
        CREATE INDEX IF NOT EXISTS idx_local_prs_status ON local_prs(status);
        CREATE INDEX IF NOT EXISTS idx_local_prs_worktree ON local_prs(worktree_path);
      `
    },
    {
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
      `
    },
    {
      name: '032_local_pr_auto_review',
      sql: `
        ALTER TABLE local_prs ADD COLUMN auto_review INTEGER NOT NULL DEFAULT 0;
      `
    },
    {
      name: '033_worktree_configs',
      sql: `
        CREATE TABLE IF NOT EXISTS worktree_configs (
          project_id TEXT NOT NULL,
          worktree_path TEXT NOT NULL,
          auto_create_pr INTEGER NOT NULL DEFAULT 0,
          auto_review INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (project_id, worktree_path),
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
      `
    },
    {
      name: '034_session_run_status',
      sql: `
        ALTER TABLE sessions ADD COLUMN last_run_status TEXT
          CHECK(last_run_status IN ('running', 'waiting', 'interrupted'));
      `
    },
    {
      name: '035_workflows',
      sql: `
        CREATE TABLE IF NOT EXISTS workflows (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT,
          status TEXT NOT NULL DEFAULT 'active'
            CHECK (status IN ('active', 'disabled', 'archived')),
          definition TEXT NOT NULL DEFAULT '{}',
          template_id TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workflows_project ON workflows(project_id);

        CREATE TABLE IF NOT EXISTS workflow_runs (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
          trigger_source TEXT NOT NULL DEFAULT 'manual'
            CHECK (trigger_source IN ('manual', 'schedule', 'event')),
          trigger_detail TEXT,
          current_step_id TEXT,
          started_at INTEGER NOT NULL,
          completed_at INTEGER,
          error TEXT,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow ON workflow_runs(workflow_id);
        CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);

        CREATE TABLE IF NOT EXISTS workflow_step_runs (
          id TEXT PRIMARY KEY,
          run_id TEXT NOT NULL,
          step_id TEXT NOT NULL,
          step_type TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending'
            CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped', 'waiting')),
          input TEXT,
          output TEXT,
          error TEXT,
          attempt INTEGER NOT NULL DEFAULT 1,
          session_id TEXT,
          started_at INTEGER,
          completed_at INTEGER,
          FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_step_runs_run ON workflow_step_runs(run_id);

        CREATE TABLE IF NOT EXISTS workflow_schedules (
          id TEXT PRIMARY KEY,
          workflow_id TEXT NOT NULL UNIQUE,
          trigger_index INTEGER NOT NULL DEFAULT 0,
          next_run INTEGER,
          enabled INTEGER NOT NULL DEFAULT 1,
          FOREIGN KEY (workflow_id) REFERENCES workflows(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_workflow_schedules_next ON workflow_schedules(enabled, next_run);
      `
    },
    {
      name: '036_local_pr_status_message',
      sql: `
        -- no-op: status_message already defined in 030_local_pr_workflow CREATE TABLE
        SELECT 1;
      `
    },
    {
      name: '037_local_pr_merge_commit_sha',
      sql: `
        -- no-op: merged_commit_sha already defined in 030_local_pr_workflow CREATE TABLE
        SELECT 1;
      `
    },
    {
      name: '038_local_pr_execution_state',
      sql: `
        ALTER TABLE local_prs ADD COLUMN execution_state TEXT NOT NULL DEFAULT 'idle'
          CHECK (execution_state IN ('idle', 'queued', 'running', 'failed'));
        ALTER TABLE local_prs ADD COLUMN pending_action TEXT NOT NULL DEFAULT 'none'
          CHECK (pending_action IN ('none', 'review', 'merge', 'resolve_conflict'));
        ALTER TABLE local_prs ADD COLUMN execution_error TEXT;
      `
    }
  ];

  const appliedMigrations = new Set(
    (db.prepare('SELECT name FROM migrations').all() as Array<{ name: string }>).map((row) => row.name)
  );

  for (const migration of migrations) {
    if (!appliedMigrations.has(migration.name)) {
      console.log(`Applying migration: ${migration.name}`);
      try {
        db.exec(migration.sql);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isDuplicateColumnError =
          message.includes('duplicate column name: status_message') ||
          message.includes('duplicate column name: merged_commit_sha');
        const isKnownLocalPrColumnMigration =
          migration.name === '036_local_pr_status_message' ||
          migration.name === '037_local_pr_merge_commit_sha';

        if (!(isKnownLocalPrColumnMigration && isDuplicateColumnError)) {
          throw error;
        }

        console.warn(`Migration ${migration.name} already applied at schema level, marking as applied.`);
      }
      db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, ?)').run(
        migration.name,
        Date.now()
      );

      // Special post-migration tasks
      if (migration.name === '008_extended_search') {
        console.log('Running post-migration indexing for extended search...');
        reindexAllMessages(db);
      }
    }
  }

  // Self-heal historical inconsistent exist
  // schemas where migration records but local_prs columns are still missing on disk (were not actually added).
  const hasLocalPrsTable = Boolean(
    db
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'local_prs'")
      .get()
  );

  if (hasLocalPrsTable) {
    const localPrColumns = new Set(
      (db.prepare("PRAGMA table_info(local_prs)").all() as Array<{ name: string }>).map(
        (row) => row.name
      )
    );

    if (!localPrColumns.has('status_message')) {
      console.warn('Schema self-heal: adding missing local_prs.status_message');
      db.exec('ALTER TABLE local_prs ADD COLUMN status_message TEXT');
    }

    if (!localPrColumns.has('merged_commit_sha')) {
      console.warn('Schema self-heal: adding missing local_prs.merged_commit_sha');
      db.exec('ALTER TABLE local_prs ADD COLUMN merged_commit_sha TEXT');
    }
  }
}

export type { Database };
