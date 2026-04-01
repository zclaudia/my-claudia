import * as path from 'path';
import * as os from 'os';
import type Database from 'better-sqlite3';

// Types for OpenCode message conversion
export interface OpenCodePartRow {
  id: string;
  message_id: string;
  session_id: string;
  time_created: number;
  time_updated: number;
  data: string;
}

export type OpenCodeMessageData = OpenCodeUserMessageData | OpenCodeAssistantMessageData;

export interface OpenCodeUserMessageData {
  role: 'user';
  time: number;
}

export interface OpenCodeAssistantMessageData {
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

export interface OpenCodeTextPart {
  type: 'text';
  text: string;
  synthetic?: boolean;
  ignored?: boolean;
}

export interface OpenCodeToolPart {
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

export interface ConvertedMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  metadata?: {
    usage?: { inputTokens: number; outputTokens: number };
    toolCalls?: Array<{ name: string; input: unknown; output?: unknown; isError?: boolean }>;
  };
  createdAt: number;
}

/**
 * Convert OpenCode message parts to our internal message format.
 */
export function convertOpenCodeMessage(
  messageId: string,
  msgData: OpenCodeMessageData,
  rawParts: OpenCodePartRow[],
): ConvertedMessage | null {
  const parsedParts: OpenCodePartData[] = [];
  for (const part of rawParts) {
    try {
      parsedParts.push(JSON.parse(part.data) as OpenCodePartData);
    } catch {
      // Skip malformed parts
    }
  }

  const textParts = parsedParts.filter(
    (part): part is OpenCodeTextPart => part.type === 'text' && !part.synthetic && !part.ignored,
  );
  const content = textParts.map(part => part.text).join('\n');

  const toolParts = parsedParts.filter(
    (part): part is OpenCodeToolPart => part.type === 'tool',
  );
  const toolCalls = toolParts.map(tool => ({
    name: tool.tool,
    input: tool.state.input,
    output: tool.state.output,
    isError: tool.state.status === 'error' || !!tool.state.error,
  }));

  const metadata: ConvertedMessage['metadata'] = {};
  if (toolCalls.length > 0) {
    metadata.toolCalls = toolCalls;
  }

  if (msgData.role === 'assistant' && msgData.tokens) {
    metadata.usage = {
      inputTokens: (msgData.tokens.input || 0) + (msgData.tokens.cache?.read || 0),
      outputTokens: msgData.tokens.output || 0,
    };
  }

  let createdAt: number;
  if (msgData.role === 'assistant' && typeof msgData.time === 'object') {
    createdAt = msgData.time.created;
  } else if (msgData.role === 'user' && typeof msgData.time === 'number') {
    createdAt = msgData.time;
  } else {
    createdAt = Date.now();
  }

  if (!content && toolCalls.length === 0) {
    return null;
  }

  return {
    id: messageId,
    role: msgData.role,
    content,
    metadata: (metadata.usage || metadata.toolCalls) ? metadata : undefined,
    createdAt,
  };
}

// Expand ~ to home directory
export function expandTilde(filepath: string): string {
  if (filepath.startsWith('~/')) {
    return path.join(os.homedir(), filepath.slice(2));
  }
  if (filepath === '~') {
    return os.homedir();
  }
  return filepath;
}

// Check for duplicate sessions
export function checkDuplicateSession(
  db: Database.Database,
  sessionId: string,
  projectId: string
): 'exists' | 'different_project' | 'not_exists' {
  const existing = db.prepare(
    'SELECT project_id FROM sessions WHERE id = ?'
  ).get(sessionId) as { project_id: string } | undefined;

  if (!existing) return 'not_exists';
  if (existing.project_id === projectId) return 'exists';
  return 'different_project';
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: Array<{
    sessionId: string;
    error: {
      code: string;
      message: string;
    };
  }>;
}

export interface ScanResult {
  projects: Array<{
    path: string;
    workspacePath?: string;
    sessions: Array<{
      id: string;
      summary: string;
      messageCount: number;
      firstPrompt?: string;
      timestamp: number;
    }>;
  }>;
}
