import type { Migration } from './types.js';

export const migration: Migration = {
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
      `,
};
