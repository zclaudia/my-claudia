import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import type Database from 'better-sqlite3';
import type { ApiResponse, Message } from '@my-claudia/shared';
import { fileStore } from '../storage/fileStore.js';
import { expandTilde, checkDuplicateSession, type ImportResult, type ScanResult } from './import-shared.js';

// Types for Claude CLI data structures
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

interface ScanRequest {
  claudeCliPath: string;
}

interface ImportRequest {
  claudeCliPath: string;
  imports: Array<{
    sessionId: string;
    projectPath: string;
    targetProjectId: string;
  }>;
  options: {
    conflictStrategy: 'skip' | 'overwrite' | 'rename';
  };
}


export function createImportRoutes(db: Database.Database): Router {
  const router = Router();

  // Scan Claude CLI directory for sessions
  router.post('/claude-cli/scan', (req: Request, res: Response) => {
    try {
      const { claudeCliPath: rawPath } = req.body as ScanRequest;

      if (!rawPath) {
        res.json({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'claudeCliPath is required' }
        } as ApiResponse<never>);
        return;
      }

      // Expand ~ to home directory
      const claudeCliPath = expandTilde(rawPath);

      // Check if directory exists
      if (!fs.existsSync(claudeCliPath)) {
        res.json({
          success: false,
          error: { code: 'DIRECTORY_NOT_FOUND', message: `Directory not found: ${claudeCliPath}` }
        } as ApiResponse<never>);
        return;
      }

      const projectsDir = path.join(claudeCliPath, 'projects');

      if (!fs.existsSync(projectsDir)) {
        res.json({
          success: false,
          error: { code: 'NO_PROJECTS', message: 'No projects directory found' }
        } as ApiResponse<never>);
        return;
      }

      const projects = scanProjects(projectsDir);

      res.json({
        success: true,
        data: { projects }
      } as ApiResponse<ScanResult>);
    } catch (error) {
      console.error('Error scanning Claude CLI directory:', error);
      res.json({
        success: false,
        error: {
          code: 'SCAN_ERROR',
          message: error instanceof Error ? error.message : 'Failed to scan directory'
        }
      } as ApiResponse<never>);
    }
  });

  // Import selected sessions
  router.post('/claude-cli/import', async (req: Request, res: Response) => {
    try {
      const { claudeCliPath: rawPath, imports, options } = req.body as ImportRequest;

      if (!rawPath || !imports || !Array.isArray(imports)) {
        res.json({
          success: false,
          error: { code: 'INVALID_REQUEST', message: 'Invalid request parameters' }
        } as ApiResponse<never>);
        return;
      }

      // Expand ~ to home directory
      const claudeCliPath = expandTilde(rawPath);

      const result = await importSessions(db, claudeCliPath, imports, options);

      res.json({
        success: true,
        data: result
      } as ApiResponse<ImportResult>);
    } catch (error) {
      console.error('Error importing sessions:', error);
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

// Scan projects directory for sessions
function scanProjects(projectsDir: string) {
  const projects: Array<{
    path: string;
    workspacePath?: string;
    sessions: Array<{
      id: string;
      summary: string;
      messageCount: number;
      firstPrompt?: string;
      timestamp: number;
    }>;
  }> = [];

  const projectDirs = fs.readdirSync(projectsDir);

  for (const projectDir of projectDirs) {
    const projectPath = path.join(projectsDir, projectDir);
    const stat = fs.statSync(projectPath);

    if (!stat.isDirectory()) continue;

    // Try sessions-index.json first (older Claude CLI versions)
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
            timestamp: entry.fileMtime
          }));

          // Try to extract workspacePath from first session file
          const workspacePath = extractWorkspacePathFromFirstSession(projectPath, index.entries);

          projects.push({
            path: projectDir,
            workspacePath,
            sessions
          });
          continue;
        }
      } catch (error) {
        console.error(`Error parsing sessions-index.json in ${projectDir}:`, error);
      }
    }

    // Fallback: discover sessions from .jsonl files directly
    const result = scanJsonlFiles(projectPath);
    if (result.sessions.length > 0) {
      projects.push({
        path: projectDir,
        workspacePath: result.workspacePath,
        sessions: result.sessions
      });
    }
  }

  return projects;
}

// Extract workspace path (cwd) from the first session JSONL file
function extractWorkspacePathFromFirstSession(
  projectPath: string,
  entries: ClaudeSessionEntry[]
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

// Scan a project directory for .jsonl session files (newer Claude CLI format)
function scanJsonlFiles(projectPath: string): {
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
            // Extract cwd from first user message for workspace path
            if (!workspacePath && msg.type === 'user' && (msg as any).cwd) {
              workspacePath = (msg as any).cwd;
            }
            if (!firstPrompt && msg.type === 'user' && msg.message) {
              const text = typeof msg.message.content === 'string'
                ? msg.message.content
                : Array.isArray(msg.message.content)
                  ? msg.message.content.find(b => b.type === 'text')?.text || ''
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
        timestamp: fileStat.mtimeMs
      });
    } catch (error) {
      console.error(`Error scanning session file ${filePath}:`, error);
    }
  }

  // Sort by timestamp descending (newest first)
  sessions.sort((a, b) => b.timestamp - a.timestamp);

  return { sessions, workspacePath: workspacePath || undefined };
}

// Parse Claude CLI session file (JSONL format)
function parseClaudeSession(
  claudeCliPath: string,
  projectPath: string,
  sessionId: string
): ClaudeSessionData {
  const sessionFile = path.join(
    claudeCliPath,
    'projects',
    projectPath,
    `${sessionId}.jsonl`
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
    cwd
  };
}

// Convert Claude message to my-claudia format
function convertMessage(
  claudeMsg: ClaudeMessage,
  targetSessionId: string
): Omit<Message, 'id'> & { id: string } {
  const { uuid, timestamp, message } = claudeMsg;

  if (!uuid || !timestamp || !message) {
    throw new Error('Invalid Claude message format');
  }

  // Process content
  let content: string;
  if (typeof message.content === 'string') {
    content = message.content;
  } else if (Array.isArray(message.content)) {
    // Merge text blocks, ignore thinking
    content = message.content
      .filter(block => block.type === 'text' && block.text)
      .map(block => block.text)
      .join('\n');
  } else {
    content = '';
  }

  // Extract metadata
  const metadata: any = {};

  if (message.usage) {
    metadata.usage = {
      inputTokens: message.usage.input_tokens || 0,
      outputTokens: message.usage.output_tokens || 0
    };
  }

  // Extract tool calls
  if (Array.isArray(message.content)) {
    const toolBlocks = message.content.filter(
      b => b.type === 'tool_use' || b.type === 'tool_result'
    );
    if (toolBlocks.length > 0) {
      metadata.toolCalls = extractToolCalls(toolBlocks);
    }
  }

  return {
    id: uuid,
    sessionId: targetSessionId,
    role: message.role,
    content,
    metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    createdAt: new Date(timestamp).getTime()
  };
}

// Extract tool calls from content blocks
function extractToolCalls(toolBlocks: any[]): any[] {
  const toolCalls: any[] = [];
  const toolUseMap = new Map<string, any>();

  for (const block of toolBlocks) {
    if (block.type === 'tool_use') {
      toolUseMap.set(block.id || block.name, {
        name: block.name,
        input: block.input
      });
    } else if (block.type === 'tool_result') {
      const toolUse = toolUseMap.get(block.tool_use_id || block.id);
      if (toolUse) {
        toolCalls.push({
          name: toolUse.name,
          input: toolUse.input,
          output: block.content || block.result
        });
      }
    }
  }

  // Add tool uses without results
  for (const [id, toolUse] of toolUseMap.entries()) {
    if (!toolCalls.find(tc => tc.name === toolUse.name && tc.input === toolUse.input)) {
      toolCalls.push(toolUse);
    }
  }

  return toolCalls;
}

// Import sessions with transactions
async function importSessions(
  db: Database.Database,
  claudeCliPath: string,
  imports: ImportRequest['imports'],
  options: ImportRequest['options']
): Promise<ImportResult> {
  const results: ImportResult = {
    imported: 0,
    skipped: 0,
    errors: []
  };

  for (const item of imports) {
    try {
      // Use transaction for each session
      const transaction = db.transaction(() => {
        // 1. Check for duplicates
        const conflict = checkDuplicateSession(db, item.sessionId, item.targetProjectId);

        if (conflict === 'exists' && options.conflictStrategy === 'skip') {
          results.skipped++;
          return;
        }

        if (conflict !== 'not_exists' && options.conflictStrategy === 'overwrite') {
          // Delete existing session and messages
          db.prepare('DELETE FROM messages WHERE session_id = ?').run(item.sessionId);
          db.prepare('DELETE FROM sessions WHERE id = ?').run(item.sessionId);
        }

        // 2. Parse session data
        const sessionData = parseClaudeSession(
          claudeCliPath,
          item.projectPath,
          item.sessionId
        );

        if (sessionData.messages.length === 0) {
          throw new Error('No messages found in session');
        }

        // 3. Insert session
        db.prepare(`
          INSERT INTO sessions (id, project_id, name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
        `).run(
          item.sessionId,
          item.targetProjectId,
          sessionData.summary,
          new Date(sessionData.firstTimestamp || Date.now()).getTime(),
          new Date(sessionData.lastTimestamp || Date.now()).getTime()
        );

        // 4. Insert messages
        const insertMessage = db.prepare(`
          INSERT INTO messages (id, session_id, role, content, metadata, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `);

        for (const claudeMsg of sessionData.messages) {
          try {
            const msg = convertMessage(claudeMsg, item.sessionId);
            insertMessage.run(
              msg.id,
              msg.sessionId,
              msg.role,
              msg.content,
              msg.metadata ? JSON.stringify(msg.metadata) : null,
              msg.createdAt
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
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  return results;
}
