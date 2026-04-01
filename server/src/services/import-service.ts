import * as fs from 'fs';
import * as path from 'path';
import BetterSqlite3 from 'better-sqlite3';
import type Database from 'better-sqlite3';
import type { Message } from '@my-claudia/shared';
import { checkDuplicateSession, convertOpenCodeMessage, type ImportResult, type ScanResult, type OpenCodePartRow } from '../routes/import-shared.js';

interface ClaudeSessionEntry {
  sessionId: string;
  fullPath: string;
  fileMtime: number;
  firstPrompt?: string;
  summary?: string;
  messageCount: number;
}

interface ClaudeMessage {
  type: 'user' | 'assistant' | 'summary' | 'file-history-snapshot';
  uuid?: string;
  timestamp?: string;
  sessionId?: string;
  cwd?: string;
  message?: {
    role: 'user' | 'assistant' | 'system';
    content: string | Array<{ type: string; text?: string; thinking?: string; [key: string]: any }>;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
    };
  };
  summary?: string;
}

interface ClaudeSessionData {
  sessionId: string;
  summary: string;
  messages: ClaudeMessage[];
  firstTimestamp?: string;
  lastTimestamp?: string;
  cwd?: string;
}

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

export interface ClaudeImportItem {
  sessionId: string;
  projectPath: string;
  targetProjectId: string;
}

export interface ClaudeImportOptions {
  conflictStrategy: 'skip' | 'overwrite' | 'rename';
}

export interface OpenCodeImportItem {
  sessionId: string;
  targetProjectId: string;
}

export interface OpenCodeImportOptions {
  conflictStrategy: 'skip' | 'overwrite' | 'rename';
}

export class ImportService {
  constructor(private db: Database.Database) {}

  scanClaudeProjects(projectsDir: string): ScanResult['projects'] {
    const projects: ScanResult['projects'] = [];
    const projectDirs = fs.readdirSync(projectsDir);

    for (const projectDir of projectDirs) {
      const projectPath = path.join(projectsDir, projectDir);
      const stat = fs.statSync(projectPath);

      if (!stat.isDirectory()) continue;

      const indexPath = path.join(projectPath, 'sessions-index.json');

      if (fs.existsSync(indexPath)) {
        try {
          const indexContent = fs.readFileSync(indexPath, 'utf-8');
          const index = JSON.parse(indexContent);

          if (index.entries && Array.isArray(index.entries)) {
            const sessions = index.entries.map((entry: ClaudeSessionEntry) => ({
              id: entry.sessionId,
              summary: entry.summary || entry.firstPrompt || 'Untitled Session',
              messageCount: entry.messageCount || 0,
              firstPrompt: entry.firstPrompt,
              timestamp: entry.fileMtime,
            }));

            const workspacePath = this.extractWorkspacePathFromFirstSession(projectPath, index.entries);

            projects.push({
              path: projectDir,
              workspacePath,
              sessions,
            });
            continue;
          }
        } catch (error) {
          console.error(`Error parsing sessions-index.json in ${projectDir}:`, error);
        }
      }

      const result = this.scanJsonlFiles(projectPath);
      if (result.sessions.length > 0) {
        projects.push({
          path: projectDir,
          workspacePath: result.workspacePath,
          sessions: result.sessions,
        });
      }
    }

    return projects;
  }

  async importClaudeSessions(
    claudeCliPath: string,
    imports: ClaudeImportItem[],
    options: ClaudeImportOptions,
  ): Promise<ImportResult> {
    const results: ImportResult = {
      imported: 0,
      skipped: 0,
      errors: [],
    };

    for (const item of imports) {
      try {
        const transaction = this.db.transaction(() => {
          const conflict = checkDuplicateSession(this.db, item.sessionId, item.targetProjectId);

          if (conflict === 'exists' && options.conflictStrategy === 'skip') {
            results.skipped++;
            return;
          }

          if (conflict !== 'not_exists' && options.conflictStrategy === 'overwrite') {
            this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(item.sessionId);
            this.db.prepare('DELETE FROM sessions WHERE id = ?').run(item.sessionId);
          }

          const sessionData = this.parseClaudeSession(
            claudeCliPath,
            item.projectPath,
            item.sessionId,
          );

          if (sessionData.messages.length === 0) {
            throw new Error('No messages found in session');
          }

          this.db.prepare(`
            INSERT INTO sessions (id, project_id, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
          `).run(
            item.sessionId,
            item.targetProjectId,
            sessionData.summary,
            new Date(sessionData.firstTimestamp || Date.now()).getTime(),
            new Date(sessionData.lastTimestamp || Date.now()).getTime(),
          );

          const insertMessage = this.db.prepare(`
            INSERT INTO messages (id, session_id, role, content, metadata, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
          `);

          for (const claudeMsg of sessionData.messages) {
            try {
              const msg = this.convertMessage(claudeMsg, item.sessionId);
              insertMessage.run(
                msg.id,
                msg.sessionId,
                msg.role,
                msg.content,
                msg.metadata ? JSON.stringify(msg.metadata) : null,
                msg.createdAt,
              );
            } catch (error) {
              console.error(`Error converting message ${claudeMsg.uuid}:`, error);
            }
          }

          results.imported++;
        });

        transaction();
      } catch (error) {
        results.errors.push({
          sessionId: item.sessionId,
          error: {
            code: 'IMPORT_ERROR',
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    }

    return results;
  }

  scanOpenCodeDb(dbPath: string): ScanResult {
    const extDb = new BetterSqlite3(dbPath, { readonly: true, fileMustExist: true });
    try {
      const tables = extDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('session', 'message', 'part')"
      ).all() as Array<{ name: string }>;
      const tableNames = new Set(tables.map(table => table.name));

      if (!tableNames.has('session') || !tableNames.has('message')) {
        throw new Error('Invalid OpenCode database: missing required tables');
      }

      const hasProjectTable = tableNames.has('project') || extDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='project'"
      ).get() !== undefined;

      let projectPathMap = new Map<string, string>();
      if (hasProjectTable) {
        try {
          const projects = extDb.prepare('SELECT id, path FROM project').all() as Array<{ id: string; path: string }>;
          projectPathMap = new Map(projects.map(project => [project.id, project.path]));
        } catch {
          // project table might have different schema
        }
      }

      const sessions = extDb.prepare(`
        SELECT s.id, s.project_id, s.title, s.directory,
               s.time_created, s.time_updated,
               (SELECT COUNT(*) FROM message m WHERE m.session_id = s.id) as message_count
        FROM session s
        WHERE s.time_created IS NOT NULL
        ORDER BY s.time_updated DESC
      `).all() as OpenCodeSessionRow[];

      const projectMap = new Map<string, ScanResult['projects'][0]>();

      for (const session of sessions) {
        const projectPath = projectPathMap.get(session.project_id) || session.directory || 'Unknown Project';
        const projectKey = session.project_id || projectPath;

        if (!projectMap.has(projectKey)) {
          projectMap.set(projectKey, {
            path: projectPath,
            workspacePath: projectPath !== 'Unknown Project' ? projectPath : undefined,
            sessions: [],
          });
        }

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
            // json_extract might not work with all SQLite versions
          }
        }

        projectMap.get(projectKey)!.sessions.push({
          id: session.id,
          summary: session.title || firstPrompt || 'Untitled Session',
          messageCount: session.message_count,
          firstPrompt,
          timestamp: session.time_updated || session.time_created,
        });
      }

      return { projects: Array.from(projectMap.values()) };
    } finally {
      extDb.close();
    }
  }

  importOpenCodeSessions(
    extDbPath: string,
    imports: OpenCodeImportItem[],
    options: OpenCodeImportOptions,
  ): ImportResult {
    const results: ImportResult = { imported: 0, skipped: 0, errors: [] };
    const extDb = new BetterSqlite3(extDbPath, { readonly: true, fileMustExist: true });

    const opencodeProvider = this.db.prepare(
      `SELECT id FROM providers WHERE type = 'opencode' LIMIT 1`
    ).get() as { id: string } | undefined;

    try {
      for (const item of imports) {
        try {
          const transaction = this.db.transaction(() => {
            const conflict = checkDuplicateSession(this.db, item.sessionId, item.targetProjectId);

            if (conflict === 'exists' && options.conflictStrategy === 'skip') {
              results.skipped++;
              return;
            }

            if (conflict !== 'not_exists' && options.conflictStrategy === 'overwrite') {
              this.db.prepare('DELETE FROM messages WHERE session_id = ?').run(item.sessionId);
              this.db.prepare('DELETE FROM sessions WHERE id = ?').run(item.sessionId);
            }

            const sessionData = this.parseOpenCodeSession(extDb, item.sessionId);

            if (sessionData.messages.length === 0) {
              throw new Error('No messages found in session');
            }

            this.db.prepare(`
              INSERT INTO sessions (id, project_id, name, provider_id, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              item.sessionId,
              item.targetProjectId,
              sessionData.title,
              opencodeProvider?.id || null,
              sessionData.timeCreated,
              sessionData.timeUpdated,
            );

            const insertMessage = this.db.prepare(`
              INSERT INTO messages (id, session_id, role, content, metadata, created_at, offset)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `);

            let importOffset = 0;
            for (const msg of sessionData.messages) {
              try {
                importOffset++;
                insertMessage.run(
                  msg.id,
                  item.sessionId,
                  msg.role,
                  msg.content,
                  msg.metadata ? JSON.stringify(msg.metadata) : null,
                  msg.createdAt,
                  importOffset,
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
            error: {
              code: 'IMPORT_ERROR',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
          });
        }
      }
    } finally {
      extDb.close();
    }

    return results;
  }

  private parseClaudeSession(
    claudeCliPath: string,
    projectPath: string,
    sessionId: string,
  ): ClaudeSessionData {
    const sessionFile = path.join(
      claudeCliPath,
      'projects',
      projectPath,
      `${sessionId}.jsonl`,
    );

    if (!fs.existsSync(sessionFile)) {
      throw new Error(`Session file not found: ${sessionFile}`);
    }

    const fileContent = fs.readFileSync(sessionFile, 'utf-8');
    const lines = fileContent.split('\n').filter(line => line.trim());

    const messages: ClaudeMessage[] = [];
    let summary = '';
    let cwd = '';

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as ClaudeMessage;

        if (entry.type === 'summary') {
          summary = entry.summary || '';
        } else if (entry.type === 'user' || entry.type === 'assistant') {
          messages.push(entry);
          if (entry.cwd && !cwd) {
            cwd = entry.cwd;
          }
        }
      } catch (error) {
        console.error(`Error parsing line in ${sessionFile}:`, error);
      }
    }

    return {
      sessionId,
      summary: summary || 'Imported Session',
      messages,
      firstTimestamp: messages[0]?.timestamp,
      lastTimestamp: messages[messages.length - 1]?.timestamp,
      cwd,
    };
  }

  private extractWorkspacePathFromFirstSession(
    projectPath: string,
    entries: ClaudeSessionEntry[],
  ): string | undefined {
    if (!entries || entries.length === 0) return undefined;

    const firstSessionId = entries[0].sessionId;
    const sessionFile = path.join(projectPath, `${firstSessionId}.jsonl`);

    if (!fs.existsSync(sessionFile)) return undefined;

    try {
      const content = fs.readFileSync(sessionFile, 'utf-8');
      const lines = content.split('\n');

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'user' && msg.cwd) {
            return msg.cwd;
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // ignore read errors
    }

    return undefined;
  }

  private scanJsonlFiles(projectPath: string): {
    sessions: Array<{
      id: string;
      summary: string;
      messageCount: number;
      firstPrompt?: string;
      timestamp: number;
    }>;
    workspacePath?: string;
  } {
    const sessions: Array<{
      id: string;
      summary: string;
      messageCount: number;
      firstPrompt?: string;
      timestamp: number;
    }> = [];

    let workspacePath = '';
    const entries = fs.readdirSync(projectPath);

    for (const entry of entries) {
      if (!entry.endsWith('.jsonl')) continue;

      const filePath = path.join(projectPath, entry);
      const fileStat = fs.statSync(filePath);
      if (!fileStat.isFile()) continue;

      const sessionId = entry.replace('.jsonl', '');

      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        const lines = content.split('\n').filter(line => line.trim());

        let summary = '';
        let firstPrompt = '';
        let messageCount = 0;

        for (const line of lines) {
          try {
            const msg = JSON.parse(line) as ClaudeMessage;

            if (msg.type === 'summary') {
              summary = msg.summary || '';
            } else if (msg.type === 'user' || msg.type === 'assistant') {
              messageCount++;
              if (!workspacePath && msg.type === 'user' && msg.cwd) {
                workspacePath = msg.cwd;
              }
              if (!firstPrompt && msg.type === 'user' && msg.message) {
                const text = typeof msg.message.content === 'string'
                  ? msg.message.content
                  : Array.isArray(msg.message.content)
                    ? msg.message.content.find(block => block.type === 'text')?.text || ''
                    : '';
                if (text && !(msg as any).isMeta) {
                  firstPrompt = text.slice(0, 200);
                }
              }
            }
          } catch {
            // skip malformed lines
          }
        }

        if (messageCount === 0) continue;

        sessions.push({
          id: sessionId,
          summary: summary || firstPrompt || 'Untitled Session',
          messageCount,
          firstPrompt: firstPrompt || undefined,
          timestamp: fileStat.mtimeMs,
        });
      } catch (error) {
        console.error(`Error scanning session file ${filePath}:`, error);
      }
    }

    sessions.sort((a, b) => b.timestamp - a.timestamp);

    return { sessions, workspacePath: workspacePath || undefined };
  }

  private convertMessage(
    claudeMsg: ClaudeMessage,
    targetSessionId: string,
  ): Omit<Message, 'id'> & { id: string } {
    const { uuid, timestamp, message } = claudeMsg;

    if (!uuid || !timestamp || !message) {
      throw new Error('Invalid Claude message format');
    }

    let content: string;
    if (typeof message.content === 'string') {
      content = message.content;
    } else if (Array.isArray(message.content)) {
      content = message.content
        .filter(block => block.type === 'text' && block.text)
        .map(block => block.text)
        .join('\n');
    } else {
      content = '';
    }

    const metadata: Record<string, unknown> = {};

    if (message.usage) {
      metadata.usage = {
        inputTokens: message.usage.input_tokens || 0,
        outputTokens: message.usage.output_tokens || 0,
      };
    }

    if (Array.isArray(message.content)) {
      const toolBlocks = message.content.filter(
        block => block.type === 'tool_use' || block.type === 'tool_result',
      );
      if (toolBlocks.length > 0) {
        metadata.toolCalls = this.extractToolCalls(toolBlocks);
      }
    }

    return {
      id: uuid,
      sessionId: targetSessionId,
      role: message.role,
      content,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      createdAt: new Date(timestamp).getTime(),
    };
  }

  private extractToolCalls(toolBlocks: any[]): any[] {
    const toolCalls: any[] = [];
    const toolUseMap = new Map<string, any>();

    for (const block of toolBlocks) {
      if (block.type === 'tool_use') {
        toolUseMap.set(block.id || block.name, {
          name: block.name,
          input: block.input,
        });
      } else if (block.type === 'tool_result') {
        const toolUse = toolUseMap.get(block.tool_use_id || block.id);
        if (toolUse) {
          toolCalls.push({
            name: toolUse.name,
            input: toolUse.input,
            output: block.content || block.result,
          });
        }
      }
    }

    for (const toolUse of toolUseMap.values()) {
      if (!toolCalls.find(tc => tc.name === toolUse.name && tc.input === toolUse.input)) {
        toolCalls.push(toolUse);
      }
    }

    return toolCalls;
  }

  private parseOpenCodeSession(
    extDb: Database.Database,
    sessionId: string,
  ): { title: string; messages: ConvertedMessage[]; timeCreated: number; timeUpdated: number } {
    const session = extDb.prepare('SELECT * FROM session WHERE id = ?')
      .get(sessionId) as OpenCodeSessionRow | undefined;
    if (!session) throw new Error(`Session not found: ${sessionId}`);

    const rawMessages = extDb.prepare(
      'SELECT * FROM message WHERE session_id = ? ORDER BY time_created ASC'
    ).all(sessionId) as OpenCodeMessageRow[];

    const hasParts = extDb.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='part'"
    ).get() !== undefined;

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
      timeUpdated: session.time_updated,
    };
  }
}
