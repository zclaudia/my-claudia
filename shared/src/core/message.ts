// Message Types

export type MessageRole = 'user' | 'assistant' | 'system';

// File attachment reference (uses fileId instead of embedded base64)
export interface MessageAttachment {
  fileId: string;        // Reference to uploaded file
  name: string;          // Original filename
  mimeType: string;      // MIME type
  type: 'image' | 'file'; // Attachment type
}

// Structured message input (for messages with attachments)
export interface MessageInput {
  text: string;
  attachments?: MessageAttachment[];
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata?: MessageMetadata;
  createdAt: number;
  offset?: number;  // Per-session sequential message number (for gap detection)
}

export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolUseId: string };

export interface MessageMetadata {
  toolCalls?: ToolCall[];
  contentBlocks?: ContentBlock[];
  usage?: UsageInfo;
  filePush?: FilePushMetadata;
}

export interface FilePushMetadata {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  description?: string;
  autoDownload: boolean;
}

export interface ToolCall {
  toolUseId?: string;
  name: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
}

// Note: ToolDefinition and AIToolCall are defined in plugin-types.ts
