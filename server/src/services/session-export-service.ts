import type Database from 'better-sqlite3';

interface ExportSessionRow {
  id: string;
  projectId: string;
  name?: string | null;
  createdAt: number;
}

interface ExportMessageRow {
  role: string;
  content: string;
  metadata: string | null;
  createdAt: number;
}

export interface SessionExportResult {
  markdown: string;
  sessionName: string;
}

export class SessionExportError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export class SessionExportService {
  constructor(private readonly db: Database.Database) {}

  exportSession(sessionId: string): SessionExportResult {
    const session = this.db.prepare(`
      SELECT id, project_id as projectId, name, created_at as createdAt
      FROM sessions WHERE id = ?
    `).get(sessionId) as ExportSessionRow | undefined;

    if (!session) {
      throw new SessionExportError(404, 'NOT_FOUND', 'Session not found');
    }

    const messages = this.db.prepare(`
      SELECT role, content, metadata, created_at as createdAt
      FROM messages WHERE session_id = ? ORDER BY created_at ASC
    `).all(sessionId) as ExportMessageRow[];

    const lines: string[] = [];
    const sessionName = session.name || 'Untitled Session';
    lines.push(`# ${sessionName}`);
    lines.push(`Created: ${new Date(session.createdAt).toLocaleString()}`);
    lines.push('', '---', '');

    for (const msg of messages) {
      const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      const time = new Date(msg.createdAt).toLocaleTimeString();
      lines.push(`## ${roleLabel} *(${time})*`, '', msg.content, '');

      if (msg.metadata) {
        this.appendMetadata(lines, msg.metadata);
      }

      lines.push('---', '');
    }

    return {
      markdown: lines.join('\n'),
      sessionName,
    };
  }

  private appendMetadata(lines: string[], rawMetadata: string): void {
    try {
      const meta = JSON.parse(rawMetadata) as {
        toolCalls?: Array<{
          name?: string;
          input?: Record<string, unknown>;
          isError?: boolean;
        }>;
        usage?: {
          inputTokens?: number;
          outputTokens?: number;
        };
      };

      if (meta.toolCalls && meta.toolCalls.length > 0) {
        lines.push('**Tool Calls:**');
        for (const toolCall of meta.toolCalls) {
          const status = toolCall.isError ? 'error' : 'ok';
          const input = toolCall.input && typeof toolCall.input === 'object'
            ? toolCall.input.file_path || toolCall.input.command || toolCall.input.pattern || ''
            : '';
          lines.push(`- **${toolCall.name || 'Unknown'}** \`${String(input)}\` -> ${status}`);
        }
        lines.push('');
      }

      if (meta.usage) {
        lines.push(
          `*Tokens: ${(meta.usage.inputTokens || 0).toLocaleString()} in / ${(meta.usage.outputTokens || 0).toLocaleString()} out*`,
          '',
        );
      }
    } catch {
      // Ignore malformed metadata during export.
    }
  }
}
