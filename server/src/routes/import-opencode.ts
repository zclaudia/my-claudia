import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared';
import { expandTilde, checkDuplicateSession, type ImportResult, type ScanResult } from './import-shared.js';

// OpenCode SQLite row types
interface OpenCodeSessionRow {
  id: string;
  project_id: string;
  title: string;
  directory: string;
  time_created: number;
  time_updated: number;
  message_count: number;
}

interface OpenCodeMessageRow {
  id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

interface OpenCodePartRow {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

// Parsed message data discriminated by role
interface OpenCodeUserMessageData {
  role: 'user';
  time: number;
}

interface OpenCodeAssistantMessageData {
  role: 'assistant';
  time: { created: number; completed?: number };
  tokens?: {
    total?: number;
    input: number;
    output: number;
    reasoning: number;
    cache: { read: number; write: number };
  };
  cost?: number;
}

type OpenCodeMessageData = OpenCodeUserMessageData | OpenCodeAssistantMessageData;

// Parsed part data discriminated by type
interface OpenCodeTextPart {
  type: 'text';
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
}

interface OpenCodeToolPart {
  type: 'tool';
  callID: string;
  tool: string;
  state: {
    status: string;
    input: unknown;
    output?: unknown;
    error?: string;
  };
}

type OpenCodePartData = OpenCodeTextPart | OpenCodeToolPart | { type: string; [key: string]: any };

// Request types
interface OpenCodeScanRequest {
  opencodePath?: string;
}

interface OpenCodeImportRequest {
  opencodePath?: string;
  imports: Array<{
    sessionId: string;
    targetProjectId: string;
  }>;
  options: {
    conflictStrategy: 'skip' | 'overwrite' | 'rename';
  };
}

// Converted message ready for insertion
interface ConvertedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    usage?: { inputTokens: number; outputTokens: number };
    toolCalls?: Array<{ name: string; input: unknown; output?: unknown; isError?: boolean }>;
  };
  createdAt: number;
}

export function getDefaultOpenCodeDbPath(): string {
  const platform = os.platform();
  if (platform === 'darwin') {
    const xdgDataHome = process.env.XDG_DATA_HOME;
    if (xdgDataHome) {
      return path.join(xdgDataHome, 'opencode', 'opencode.db');
    }
    return path.join(os.homedir(), 'Library', 'Application Support', 'opencode', 'opencode.db');
  }
  // Linux and others: XDG_DATA_HOME or ~/.local/share
  const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
  return path.join(xdgDataHome, 'opencode', 'opencode.db');
}

export function scanOpenCodeDb(dbPath: string): ScanResult {
  const extDb = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
  try {
    // Check if required tables exist
    const tables = extDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session', 'message', 'part')"
    ).all() as Array<{ name: string }>;
    const tableNames = new Set(tables.map(t => t.name));

    if (!tableNames.has('session') || !tableNames.has('message')) {
      throw new Error('Invalid OpenCode database: missing required tables');
    }

    // Check if project table exists for path mapping
    const hasProjectTable = tableNames.has('project') || extDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='project'"
    ).get() !== undefined;

    let projectPathMap = new Map<string, string>();
    if (hasProjectTable) {
      try {
        const projects = extDb.prepare('SELECT id, path FROM project').all() as Array<{ id: string; path: string }>;
        projectPathMap = new Map(projects.map(p => [p.id, p.path]));
      } catch {
        // project table might have different schema
      }
    }

    // Query sessions with message count
    const sessions = extDb.prepare(`
      SELECT s.id, s.project_id, s.title, s.directory,
             s.time_created, s.time_updated,
             (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) as message_count
      FROM session s
      WHERE s.time_created IS NOT NULL
      ORDER BY s.time_updated DESC
    `).all() as OpenCodeSessionRow[];

    // Group sessions by project
    const projectMap = new Map<string, ScanResult['projects'][0]>();

    for (const session of sessions) {
      const projectPath = projectPathMap.get(session.project_id) || session.directory || 'Unknown Project';
      const projectKey = session.project_id || projectPath;

      if (!projectMap.has(projectKey)) {
        projectMap.set(projectKey, {
          path: projectPath,
          workspacePath: projectPath !== 'Unknown Project' ? projectPath : undefined,
          sessions: []
        });
      }

      // Get first user text part as firstPrompt
      let firstPrompt: string | undefined;
      if (tableNames.has('part')) {
        try {
          const firstPart = extDb.prepare(`
            SELECT p.data FROM part p
            JOIN message m ON p.message_id = m.id
            WHERE p.session_id = ? AND json_extract(m.data, '$.role') = 'user'
            AND json_extract(p.data, '$.type') = 'text'
            ORDER BY p.time_created ASC LIMIT 1
          `).get(session.id) as { data: string } | undefined;

          if (firstPart) {
            const parsed = JSON.parse(firstPart.data);
            firstPrompt = parsed.text?.slice(0, 200);
          }
        } catch {
          // json_extract might not work with all SQLite versions, skip
        }
      }

      projectMap.get(projectKey)!.sessions.push({
        id: session.id,
        summary: session.title || firstPrompt || 'Untitled Session',
        messageCount: session.message_count,
        firstPrompt,
        timestamp: session.time_updated || session.time_created
      });
    }

    return { projects: Array.from(projectMap.values()) };
  } finally {
    extDb.close();
  }
}

export function convertOpenCodeMessage(
  messageId: string,
  msgData: OpenCodeMessageData,
  rawParts: OpenCodePartRow[]
): ConvertedMessage | null {
  const parsedParts: OpenCodePartData[] = [];
  for (const p of rawParts) {
    try {
      parsedParts.push(JSON.parse(p.data) as OpenCodePartData);
    } catch {
      // Skip malformed parts
    }
  }

  // Collect text parts (skip synthetic and ignored)
  const textParts = parsedParts.filter(
    (p): p is OpenCodeTextPart => p.type === 'text' && !p.synthetic && !p.ignored
  );
  const content = textParts.map(p => p.text).join('\n');

  // Extract tool calls from tool parts
  const toolParts = parsedParts.filter(
    (p): p is OpenCodeToolPart => p.type === 'tool'
  );
  const toolCalls = toolParts.map(t => ({
    name: t.tool,
    input: t.state.input,
    output: t.state.output,
    isError: t.state.status === 'error' || !!t.state.error
  }));

  // Build metadata
  const metadata: ConvertedMessage['metadata'] = {};

  if (toolCalls.length > 0) {
    metadata.toolCalls = toolCalls;
  }

  // Extract usage from assistant message data
  if (msgData.role === 'assistant' && msgData.tokens) {
    metadata.usage = {
      inputTokens: (msgData.tokens.input || 0) + (msgData.tokens.cache?.read || 0),
      outputTokens: msgData.tokens.output || 0
    };
  }

  // Determine timestamp
  let createdAt: number;
  if (msgData.role === 'assistant' && typeof msgData.time === 'object') {
    createdAt = msgData.time.created;
  } else if (msgData.role === 'user' && typeof msgData.time === 'number') {
    createdAt = msgData.time;
  } else {
    createdAt = Date.now();
  }

  // Skip messages with no content and no tool calls
  if (!content && toolCalls.length === 0) {
    return null;
  }

  return {
    id: messageId,
    role: msgData.role,
    content,
    metadata: (metadata.usage || metadata.toolCalls) ? metadata : undefined,
    createdAt
  };
}

function parseOpenCodeSession(
  extDb: Database.Database,
  sessionId: string
): { title: string; messages: ConvertedMessage[]; timeCreated: number; timeUpdated: number } {
  const session = extDb.prepare('SELECT * FROM session WHERE id = ?')
    .get(sessionId) as OpenCodeSessionRow | undefined;
  if (!session) throw new Error(`Session not found: ${sessionId}`);

  // Get all messages ordered by time
  const rawMessages = extDb.prepare(
    'SELECT * FROM message WHERE session_id = ? ORDER BY time_created ASC'
  ).all(sessionId) as OpenCodeMessageRow[];

  // Check if part table exists
  const hasParts = extDb.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='part'"
  ).get() !== undefined;

  // Get all parts grouped by message_id
  const partsByMessage = new Map<string, OpenCodePartRow[]>();
  if (hasParts) {
    const rawParts = extDb.prepare(
      'SELECT * FROM part WHERE session_id = ? ORDER BY time_created ASC'
    ).all(sessionId) as OpenCodePartRow[];

    for (const part of rawParts) {
      if (!partsByMessage.has(part.message_id)) {
        partsByMessage.set(part.message_id, []);
      }
      partsByMessage.get(part.message_id)!.push(part);
    }
  }

  // Convert each message
  const messages: ConvertedMessage[] = [];
  for (const rawMsg of rawMessages) {
    try {
      const msgData = JSON.parse(rawMsg.data) as OpenCodeMessageData;
      if (msgData.role !== 'user' && msgData.role !== 'assistant') continue;

      const parts = partsByMessage.get(rawMsg.id) || [];
      const converted = convertOpenCodeMessage(rawMsg.id, msgData, parts);
      if (converted) {
        messages.push(converted);
      }
    } catch {
      // Skip malformed messages
    }
  }

  return {
    title: session.title || 'Imported OpenCode Session',
    messages,
    timeCreated: session.time_created,
    timeUpdated: session.time_updated
  };
}

function importOpenCodeSessions(
  db: Database.Database,
  extDbPath: string,
  imports: OpenCodeImportRequest['imports'],
  options: OpenCodeImportRequest['options']
): ImportResult {
  const results: ImportResult = { imported: 0, skipped: 0, errors: [] };
  const extDb = new BetterSqlite3(extDbPath, { readonly: true, fileMustExist: true });

  // Find the OpenCode provider so imported sessions use the correct adapter
  const opencodeProvider = db.prepare(
    `SELECT id FROM providers WHERE type = 'opencode' LIMIT 1`
  ).get() as { id: string } | undefined;

  try {
    for (const item of imports) {
      try {
        const transaction = db.transaction(() => {
          const conflict = checkDuplicateSession(db, item.sessionId, item.targetProjectId);

          if (conflict === 'exists' && options.conflictStrategy === 'skip') {
            results.skipped++;
            return;
          }

          if (conflict !== 'not_exists' && options.conflictStrategy === 'overwrite') {
            db.prepare('DELETE FROM messages WHERE session_id = ?').run(item.sessionId);
            db.prepare('DELETE FROM sessions WHERE id = ?').run(item.sessionId);
          }

          const sessionData = parseOpenCodeSession(extDb, item.sessionId);

          if (sessionData.messages.length === 0) {
            throw new Error('No messages found in session');
          }

          // Insert session with OpenCode provider_id so it uses the correct adapter
          db.prepare(`
            INSERT INTO sessions (id, project_id, name, provider_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            item.sessionId,
            item.targetProjectId,
            sessionData.title,
            opencodeProvider?.id || null,
            sessionData.timeCreated,
            sessionData.timeUpdated
          );

          // Insert messages
          const insertMessage = db.prepare(`
            INSERT INTO messages (id, session_id, role, content, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          for (const msg of sessionData.messages) {
            try {
              insertMessage.run(
                msg.id,
                item.sessionId,
                msg.role,
                msg.content,
                msg.metadata ? JSON.stringify(msg.metadata) : null,
                msg.createdAt
              );
            } catch (error) {
              console.error(`Error inserting message ${msg.id}:`, error);
            }
          }

          results.imported++;
        });

        transaction();
      } catch (error) {
        results.errors.push({
          sessionId: item.sessionId,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }
  } finally {
    extDb.close();
  }

  return results;
}

export function createOpenCodeImportRoutes(db: Database.Database): Router {
  const router = Router();

  // Scan OpenCode database for sessions
  router.post('/opencode/scan', (req: Request, res: Response) => {
    try {
      const { opencodePath: rawPath } = req.body as OpenCodeScanRequest;

      // Use provided path or auto-detect
      const dbPath = rawPath ? expandTilde(rawPath) : getDefaultOpenCodeDbPath();

      // Check if file exists
      if (!fs.existsSync(dbPath)) {
        res.json({
          success: false,
          error: {
            code: 'DB_NOT_FOUND',
            message: `OpenCode database not found: ${dbPath}`
          }
        } as ApiResponse<never>);
        return;
      }

      const data = scanOpenCodeDb(dbPath);

      res.json({
        success: true,
        data
      } as ApiResponse<ScanResult>);
    } catch (error) {
      console.error('Error scanning OpenCode database:', error);
      res.json({
        success: false,
        error: {
          code: 'SCAN_ERROR',
          message: error instanceof Error ? error.message : 'Failed to scan OpenCode database'
        }
      } as ApiResponse<never>);
    }
  });

  // Import selected sessions from OpenCode
  router.post('/opencode/import', (req: Request, res: Response) => {
    try {
      const { opencodePath: rawPath, imports, options } = req.body as OpenCodeImportRequest;

      if (!imports || !Array.isArray(imports)) {
        res.json({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Invalid request parameters' }
        } as ApiResponse<never>);
        return;
      }

      const dbPath = rawPath ? expandTilde(rawPath) : getDefaultOpenCodeDbPath();

      if (!fs.existsSync(dbPath)) {
        res.json({
          success: false,
          error: {
            code: 'DB_NOT_FOUND',
            message: `OpenCode database not found: ${dbPath}`
          }
        } as ApiResponse<never>);
        return;
      }

      const result = importOpenCodeSessions(db, dbPath, imports, options);

      res.json({
        success: true,
        data: result
      } as ApiResponse<ImportResult>);
    } catch (error) {
      console.error('Error importing OpenCode sessions:', error);
      res.json({
        success: false,
        error: {
          code: 'IMPORT_ERROR',
          message: error instanceof Error ? error.message : 'Failed to import sessions'
        }
      } as ApiResponse<never>);
    }
  });

  return router;
}
