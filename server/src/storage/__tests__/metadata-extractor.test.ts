import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { extractAndIndexMetadata, removeIndexedMetadata } from '../metadata-extractor.js';

function createTestDb(): Database.Database {
  const db = new Database(':memory:');

  // Core tables needed by the metadata extractor
  db.exec(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT CHECK(role IN ('user', 'assistant', 'system')) NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS file_references (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_rowid INTEGER NOT NULL,
      message_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      source_type TEXT NOT NULL,
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

    -- FTS5 virtual tables
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

    -- Triggers for tool_call_records
    CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_insert AFTER INSERT ON tool_call_records BEGIN
      INSERT INTO tool_calls_fts(rowid, tool_name, tool_input, tool_result, session_id, message_id)
        VALUES (NEW.id, NEW.tool_name, NEW.tool_input, NEW.tool_result, NEW.session_id, NEW.message_id);
    END;

    CREATE TRIGGER IF NOT EXISTS tool_call_records_fts_delete AFTER DELETE ON tool_call_records BEGIN
      INSERT INTO tool_calls_fts(tool_calls_fts, rowid, tool_name, tool_input, tool_result, session_id, message_id)
        VALUES ('delete', OLD.id, OLD.tool_name, OLD.tool_input, OLD.tool_result, OLD.session_id, OLD.message_id);
    END;

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_file_references_message ON file_references(message_id);
    CREATE INDEX IF NOT EXISTS idx_file_references_session ON file_references(session_id);
    CREATE INDEX IF NOT EXISTS idx_tool_call_records_message ON tool_call_records(message_id);
    CREATE INDEX IF NOT EXISTS idx_tool_call_records_session ON tool_call_records(session_id);
  `);

  return db;
}

/** Insert a dummy message row and return its rowid */
function insertMessage(
  db: Database.Database,
  id: string,
  sessionId: string,
  createdAt: number
): number {
  db.prepare(`
    INSERT INTO messages (id, session_id, role, content, created_at)
    VALUES (?, ?, 'assistant', 'content', ?)
  `).run(id, sessionId, createdAt);

  const row = db.prepare('SELECT rowid FROM messages WHERE id = ?').get(id) as { rowid: number };
  return row.rowid;
}

describe('metadata-extractor', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  afterEach(() => {
    db.close();
  });

  describe('extractAndIndexMetadata', () => {
    it('extracts file_references from tool call inputs with file_path', () => {
      const msgId = 'msg-1';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        toolCalls: [
          {
            name: 'read_file',
            input: { file_path: '/src/index.ts' },
          },
        ],
      }, now);

      const refs = db.prepare('SELECT * FROM file_references WHERE message_id = ?').all(msgId) as Array<{
        file_path: string;
        source_type: string;
        session_id: string;
      }>;
      expect(refs.length).toBe(1);
      expect(refs[0].file_path).toBe('/src/index.ts');
      expect(refs[0].source_type).toBe('tool_call');
      expect(refs[0].session_id).toBe(sessionId);
    });

    it('extracts file_references from tool call inputs with paths array', () => {
      const msgId = 'msg-2';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        toolCalls: [
          {
            name: 'multi_edit',
            input: { paths: ['/a.ts', '/b.ts', '/c.ts'] },
          },
        ],
      }, now);

      const refs = db.prepare('SELECT * FROM file_references WHERE message_id = ?').all(msgId) as Array<{
        file_path: string;
      }>;
      expect(refs.length).toBe(3);
      const paths = refs.map(r => r.file_path).sort();
      expect(paths).toEqual(['/a.ts', '/b.ts', '/c.ts']);
    });

    it('extracts file_references from attachments', () => {
      const msgId = 'msg-3';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        attachments: [
          { path: '/uploads/image.png', name: 'image.png' },
          { path: '/uploads/doc.pdf' },
        ],
      }, now);

      const refs = db.prepare('SELECT * FROM file_references WHERE message_id = ?').all(msgId) as Array<{
        file_path: string;
        source_type: string;
      }>;
      expect(refs.length).toBe(2);
      expect(refs.every(r => r.source_type === 'attachment')).toBe(true);
      const paths = refs.map(r => r.file_path).sort();
      expect(paths).toEqual(['/uploads/doc.pdf', '/uploads/image.png']);
    });

    it('extracts tool_call_records', () => {
      const msgId = 'msg-4';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        toolCalls: [
          {
            name: 'bash',
            input: { command: 'ls -la' },
            result: 'file1\nfile2',
            isError: false,
          },
          {
            name: 'read_file',
            input: { file_path: '/src/main.ts' },
            result: 'content here',
            isError: false,
          },
        ],
      }, now);

      const records = db.prepare('SELECT * FROM tool_call_records WHERE message_id = ?').all(msgId) as Array<{
        tool_name: string;
        tool_input: string;
        tool_result: string;
        is_error: number;
        session_id: string;
      }>;
      expect(records.length).toBe(2);

      const bashCall = records.find(r => r.tool_name === 'bash')!;
      expect(bashCall).toBeDefined();
      expect(JSON.parse(bashCall.tool_input)).toEqual({ command: 'ls -la' });
      expect(bashCall.tool_result).toBe('"file1\\nfile2"');
      expect(bashCall.is_error).toBe(0);

      const readCall = records.find(r => r.tool_name === 'read_file')!;
      expect(readCall).toBeDefined();
      expect(readCall.session_id).toBe(sessionId);
    });

    it('records isError flag correctly', () => {
      const msgId = 'msg-5';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        toolCalls: [
          {
            name: 'bash',
            input: { command: 'bad-command' },
            result: 'command not found',
            isError: true,
          },
        ],
      }, now);

      const record = db.prepare('SELECT * FROM tool_call_records WHERE message_id = ?').get(msgId) as {
        is_error: number;
      };
      expect(record.is_error).toBe(1);
    });

    it('handles null metadata gracefully', () => {
      const msgId = 'msg-6';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      // Should not throw
      expect(() => {
        extractAndIndexMetadata(db, msgId, rowid, sessionId, null, now);
      }).not.toThrow();

      const refs = db.prepare('SELECT * FROM file_references WHERE message_id = ?').all(msgId);
      const records = db.prepare('SELECT * FROM tool_call_records WHERE message_id = ?').all(msgId);
      expect(refs.length).toBe(0);
      expect(records.length).toBe(0);
    });

    it('handles metadata with empty toolCalls and attachments', () => {
      const msgId = 'msg-7';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      expect(() => {
        extractAndIndexMetadata(db, msgId, rowid, sessionId, {
          toolCalls: [],
          attachments: [],
        }, now);
      }).not.toThrow();

      const refs = db.prepare('SELECT * FROM file_references WHERE message_id = ?').all(msgId);
      const records = db.prepare('SELECT * FROM tool_call_records WHERE message_id = ?').all(msgId);
      expect(refs.length).toBe(0);
      expect(records.length).toBe(0);
    });

    it('handles tool calls with no input or result', () => {
      const msgId = 'msg-8';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        toolCalls: [
          { name: 'noop_tool' },
        ],
      }, now);

      const record = db.prepare('SELECT * FROM tool_call_records WHERE message_id = ?').get(msgId) as {
        tool_name: string;
        tool_input: string | null;
        tool_result: string | null;
      };
      expect(record.tool_name).toBe('noop_tool');
      expect(record.tool_input).toBeNull();
      expect(record.tool_result).toBeNull();
    });
  });

  describe('removeIndexedMetadata', () => {
    it('removes all file_references and tool_call_records for a message', () => {
      const msgId = 'msg-rm-1';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        toolCalls: [
          { name: 'bash', input: { file_path: '/a.ts' }, result: 'ok' },
          { name: 'read_file', input: { file_path: '/b.ts' } },
        ],
        attachments: [{ path: '/c.ts' }],
      }, now);

      // Verify data exists
      let refs = db.prepare('SELECT COUNT(*) as cnt FROM file_references WHERE message_id = ?').get(msgId) as { cnt: number };
      let records = db.prepare('SELECT COUNT(*) as cnt FROM tool_call_records WHERE message_id = ?').get(msgId) as { cnt: number };
      expect(refs.cnt).toBeGreaterThan(0);
      expect(records.cnt).toBeGreaterThan(0);

      removeIndexedMetadata(db, msgId);

      refs = db.prepare('SELECT COUNT(*) as cnt FROM file_references WHERE message_id = ?').get(msgId) as { cnt: number };
      records = db.prepare('SELECT COUNT(*) as cnt FROM tool_call_records WHERE message_id = ?').get(msgId) as { cnt: number };
      expect(refs.cnt).toBe(0);
      expect(records.cnt).toBe(0);
    });

    it('does not affect other messages', () => {
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid1 = insertMessage(db, 'msg-a', sessionId, now);
      const rowid2 = insertMessage(db, 'msg-b', sessionId, now);

      extractAndIndexMetadata(db, 'msg-a', rowid1, sessionId, {
        toolCalls: [{ name: 'tool1', input: { file_path: '/x.ts' } }],
      }, now);

      extractAndIndexMetadata(db, 'msg-b', rowid2, sessionId, {
        toolCalls: [{ name: 'tool2', input: { file_path: '/y.ts' } }],
      }, now);

      removeIndexedMetadata(db, 'msg-a');

      const refsA = db.prepare('SELECT COUNT(*) as cnt FROM file_references WHERE message_id = ?').get('msg-a') as { cnt: number };
      const refsB = db.prepare('SELECT COUNT(*) as cnt FROM file_references WHERE message_id = ?').get('msg-b') as { cnt: number };
      expect(refsA.cnt).toBe(0);
      expect(refsB.cnt).toBe(1);
    });

    it('is safe to call with no matching records', () => {
      expect(() => removeIndexedMetadata(db, 'non-existent')).not.toThrow();
    });
  });

  describe('FTS search after indexing', () => {
    it('files_fts returns matches for indexed file paths', () => {
      const msgId = 'msg-fts-1';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        toolCalls: [
          { name: 'read_file', input: { file_path: '/src/components/Button.tsx' } },
        ],
      }, now);

      const results = db.prepare(
        `SELECT * FROM files_fts WHERE files_fts MATCH ?`
      ).all('Button') as Array<{ file_path: string }>;

      expect(results.length).toBe(1);
      expect(results[0].file_path).toBe('/src/components/Button.tsx');
    });

    it('tool_calls_fts returns matches for indexed tool names', () => {
      const msgId = 'msg-fts-2';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        toolCalls: [
          { name: 'bash', input: { command: 'npm install express' }, result: 'added 50 packages' },
        ],
      }, now);

      const byTool = db.prepare(
        `SELECT * FROM tool_calls_fts WHERE tool_calls_fts MATCH 'tool_name:bash'`
      ).all() as Array<{ tool_name: string }>;
      expect(byTool.length).toBe(1);
      expect(byTool[0].tool_name).toBe('bash');

      const byInput = db.prepare(
        `SELECT * FROM tool_calls_fts WHERE tool_calls_fts MATCH 'tool_input:express'`
      ).all() as Array<{ tool_input: string }>;
      expect(byInput.length).toBe(1);
    });

    it('FTS results are empty after removeIndexedMetadata', () => {
      const msgId = 'msg-fts-3';
      const sessionId = 'sess-1';
      const now = Date.now();
      const rowid = insertMessage(db, msgId, sessionId, now);

      extractAndIndexMetadata(db, msgId, rowid, sessionId, {
        toolCalls: [
          { name: 'read_file', input: { file_path: '/unique/path/Zxcvbn.ts' } },
        ],
      }, now);

      // Verify FTS has data
      let results = db.prepare(`SELECT * FROM files_fts WHERE files_fts MATCH ?`).all('Zxcvbn');
      expect(results.length).toBe(1);

      removeIndexedMetadata(db, msgId);

      results = db.prepare(`SELECT * FROM files_fts WHERE files_fts MATCH ?`).all('Zxcvbn');
      expect(results.length).toBe(0);
    });
  });
});
