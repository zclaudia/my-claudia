import type { Database } from 'better-sqlite3';

interface MessageMetadata {
  toolCalls?: Array<{
    name: string;
    input?: Record<string, unknown>;
    result?: unknown;
    isError?: boolean;
  }>;
  attachments?: Array<{
    path: string;
    name?: string;
  }>;
}

/**
 * Extract and index file references and tool calls from message metadata
 */
export function extractAndIndexMetadata(
  db: Database,
  messageId: string,
  messageRowid: number,
  sessionId: string,
  metadata: MessageMetadata | null,
  createdAt: number
): void {
  if (!metadata) return;

  // Extract file references from tool calls
  if (metadata.toolCalls && metadata.toolCalls.length > 0) {
    for (const toolCall of metadata.toolCalls) {
      // Index the tool call itself
      const toolInput = toolCall.input ? JSON.stringify(toolCall.input) : null;
      const toolResult = toolCall.result ? JSON.stringify(toolCall.result) : null;

      db.prepare(`
        INSERT INTO tool_call_records (message_rowid, message_id, session_id, tool_name, tool_input, tool_result, is_error, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageRowid,
        messageId,
        sessionId,
        toolCall.name,
        toolInput,
        toolResult,
        toolCall.isError ? 1 : 0,
        createdAt
      );

      // Extract file paths from tool call inputs
      if (toolCall.input && typeof toolCall.input === 'object') {
        const filePath = (toolCall.input as Record<string, unknown>).file_path as string | undefined;
        if (filePath) {
          db.prepare(`
            INSERT INTO file_references (message_rowid, message_id, session_id, file_path, source_type, created_at)
            VALUES (?, ?, ?, ?, 'tool_call', ?)
          `).run(messageRowid, messageId, sessionId, filePath, createdAt);
        }

        // Also check for paths array (some tools use this)
        const paths = (toolCall.input as Record<string, unknown>).paths as string[] | undefined;
        if (paths && Array.isArray(paths)) {
          for (const path of paths) {
            db.prepare(`
              INSERT INTO file_references (message_rowid, message_id, session_id, file_path, source_type, created_at)
              VALUES (?, ?, ?, ?, 'tool_call', ?)
            `).run(messageRowid, messageId, sessionId, path, createdAt);
          }
        }
      }
    }
  }

  // Extract file references from attachments
  if (metadata.attachments && metadata.attachments.length > 0) {
    for (const attachment of metadata.attachments) {
      db.prepare(`
        INSERT INTO file_references (message_rowid, message_id, session_id, file_path, source_type, created_at)
        VALUES (?, ?, ?, ?, 'attachment', ?)
      `).run(messageRowid, messageId, sessionId, attachment.path, createdAt);
    }
  }
}

/**
 * Remove indexed metadata for a message
 */
export function removeIndexedMetadata(db: Database, messageId: string): void {
  db.prepare('DELETE FROM file_references WHERE message_id = ?').run(messageId);
  db.prepare('DELETE FROM tool_call_records WHERE message_id = ?').run(messageId);
}

/**
 * Re-index all existing messages (for migration)
 */
export function reindexAllMessages(db: Database): void {
  const messages = db.prepare(`
    SELECT rowid, id, session_id, metadata, created_at
    FROM messages
    WHERE metadata IS NOT NULL
  `).all() as Array<{
    rowid: number;
    id: string;
    session_id: string;
    metadata: string;
    created_at: number;
  }>;

  console.log(`Re-indexing metadata for ${messages.length} messages...`);

  for (const msg of messages) {
    try {
      const metadata = JSON.parse(msg.metadata) as MessageMetadata;
      extractAndIndexMetadata(
        db,
        msg.id,
        msg.rowid,
        msg.session_id,
        metadata,
        msg.created_at
      );
    } catch (error) {
      console.error(`Failed to index metadata for message ${msg.id}:`, error);
    }
  }

  console.log('Metadata re-indexing complete');
}
