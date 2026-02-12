import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderConfig, PermissionRequest, PermissionMode, MessageInput, MessageAttachment } from '@my-claudia/shared';
import { fileStore } from '../storage/fileStore.js';

export interface ClaudeRunOptions {
  cwd: string;
  sessionId?: string;  // SDK session ID for resume
  allowedTools?: string[];
  disallowedTools?: string[];
  env?: Record<string, string>;
  cliPath?: string;
  permissionMode?: PermissionMode;  // 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan'
  model?: string;  // Override model (e.g. 'claude-sonnet-4-5-20250929')
}

export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  updatedInput?: unknown;
  message?: string;
}

export type PermissionCallback = (
  request: PermissionRequest
) => Promise<PermissionDecision>;

/**
 * Get file data by ID (from local store or Gateway)
 */
async function getFileData(fileId: string): Promise<string | null> {
  // Try local store first
  const localFile = fileStore.getFile(fileId);
  if (localFile) {
    console.log(`[Claude SDK] Retrieved file ${fileId} from local store`);
    return localFile.data;
  }

  // If in Gateway mode, fetch from Gateway
  if (process.env.GATEWAY_URL) {
    try {
      console.log(`[Claude SDK] Fetching file ${fileId} from Gateway`);
      const response = await fetch(`${process.env.GATEWAY_URL}/api/files/${fileId}`, {
        headers: {
          'Authorization': `Bearer ${process.env.GATEWAY_SECRET || ''}`
        }
      });

      if (response.ok) {
        const result = await response.json() as any;
        return result.data?.data || null;
      }
    } catch (error) {
      console.error(`[Claude SDK] Failed to fetch file from Gateway:`, error);
    }
  }

  console.error(`[Claude SDK] File ${fileId} not found`);
  return null;
}

/**
 * Prepare Claude content blocks from input
 * Supports both plain text and structured MessageInput with attachments
 */
async function prepareClaudeContent(input: string): Promise<any> {
  // Try to parse as MessageInput
  let messageInput: MessageInput;
  try {
    messageInput = JSON.parse(input);
    // Check if it's actually a MessageInput object
    if (typeof messageInput !== 'object' || !('text' in messageInput)) {
      // Not a MessageInput, treat as plain text
      return input;
    }
  } catch {
    // Not JSON, treat as plain text
    return input;
  }

  // Build content blocks
  const content: any[] = [];

  // Add text block
  if (messageInput.text) {
    content.push({
      type: 'text',
      text: messageInput.text
    });
  }

  // Add image blocks
  if (messageInput.attachments && messageInput.attachments.length > 0) {
    for (const attachment of messageInput.attachments) {
      if (attachment.type === 'image') {
        // Fetch file data
        const fileData = await getFileData(attachment.fileId);

        if (fileData) {
          console.log(`[Claude SDK] Adding image ${attachment.name} to content blocks`);
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: attachment.mimeType,
              data: fileData
            }
          });
        } else {
          console.warn(`[Claude SDK] Could not load image ${attachment.fileId}, skipping`);
        }
      }
    }
  }

  // If we built content blocks, return them; otherwise return text only
  if (content.length > 1 || (content.length === 1 && content[0].type !== 'text')) {
    return content;
  }

  return messageInput.text || input;
}

/**
 * Run Claude Agent SDK with the given input and options.
 * Yields messages as they are streamed from the SDK.
 */
export async function* runClaude(
  input: string,
  options: ClaudeRunOptions,
  onPermissionRequest?: PermissionCallback
): AsyncGenerator<ClaudeMessage, void, void> {
  const sdkOptions: Record<string, unknown> = {
    cwd: options.cwd,
    allowedTools: options.allowedTools || [],
    disallowedTools: options.disallowedTools || [],
  };

  // Set model override
  if (options.model) {
    sdkOptions.model = options.model;
    console.log('[Claude SDK] Model override:', options.model);
  }

  // Set permission mode (defaults to 'default' if not specified)
  if (options.permissionMode) {
    sdkOptions.permissionMode = options.permissionMode;
    console.log('[Claude SDK] Permission mode:', options.permissionMode);
  }

  // Resume existing session if provided
  if (options.sessionId) {
    sdkOptions.resume = options.sessionId;
  }

  // Set custom CLI path if provided (for multi-config support)
  if (options.cliPath) {
    sdkOptions.cli_path = options.cliPath;
  }

  // Set custom environment variables (for multi-config support)
  if (options.env) {
    sdkOptions.env = options.env;
  }

  // Permission handling callback
  if (onPermissionRequest) {
    sdkOptions.canUseTool = async (
      toolName: string,
      toolInput: unknown,
      context: unknown
    ) => {
      // Intercept AskUserQuestion — handled interactively via client UI
      // Always route through permission callback regardless of allowed/disallowed lists
      if (toolName === 'AskUserQuestion') {
        const requestId = crypto.randomUUID();
        const decision = await onPermissionRequest({
          requestId,
          toolName: 'AskUserQuestion',
          toolInput,
          detail: JSON.stringify(toolInput, null, 2),
          timeoutSeconds: 0,
        });
        // Deny the tool but include user's answers in message for Claude to read
        return { behavior: 'deny', message: decision.message || 'No answer provided' };
      }

      // Check allowed/disallowed lists first
      if (options.allowedTools?.includes(toolName)) {
        return { behavior: 'allow', updatedInput: toolInput };
      }
      if (options.disallowedTools?.includes(toolName)) {
        return { behavior: 'deny', message: 'Tool is disallowed' };
      }

      // Request user decision
      const requestId = crypto.randomUUID();
      const decision = await onPermissionRequest({
        requestId,
        toolName,
        toolInput,
        detail: JSON.stringify(toolInput, null, 2),
        timeoutSeconds: 0,  // 0 = no timeout, wait indefinitely for user decision
      });

      // SDK requires updatedInput when allowing
      return {
        behavior: decision.behavior,
        updatedInput: decision.behavior === 'allow' ? toolInput : undefined,
        message: decision.message,
      };
    };
  }

  // Prepare content (handles both text and structured input with attachments)
  const preparedContent = await prepareClaudeContent(input);

  // Start the query
  const queryInstance = query({
    prompt: preparedContent,
    options: sdkOptions,
  });

  // Stream messages
  for await (const message of queryInstance) {
    const transformed = transformMessage(message);
    // transformMessage can return a single message or array of messages
    if (Array.isArray(transformed)) {
      for (const msg of transformed) {
        yield msg;
      }
    } else {
      yield transformed;
    }
  }
}

export interface SystemInfo {
  model?: string;
  claudeCodeVersion?: string;
  cwd?: string;
  tools?: string[];
  mcpServers?: string[];
  permissionMode?: string;
  apiKeySource?: string;
  slashCommands?: string[];
  agents?: string[];
}

export interface ClaudeMessage {
  type: 'init' | 'assistant' | 'result' | 'tool_use' | 'tool_result' | 'error';
  sessionId?: string;
  content?: string;
  systemInfo?: SystemInfo;  // System info from init message
  toolUseId?: string;       // Unique ID for tool use (for matching tool_use and tool_result)
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  isToolError?: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  isComplete?: boolean;
}

// Transform a single message from SDK format to our internal format
// Returns an array because assistant messages may contain multiple tool_use blocks
function transformMessage(message: unknown): ClaudeMessage | ClaudeMessage[] {
  const msg = message as Record<string, unknown>;

  // Debug log message type
  console.log('[Claude SDK] Message type:', msg.type, 'subtype:', (msg as { subtype?: string }).subtype);

  switch (msg.type) {
    case 'system':
      if ((msg as { subtype?: string }).subtype === 'init') {
        // Extract system info from init message
        const systemInfo: SystemInfo = {
          model: msg.model as string | undefined,
          claudeCodeVersion: msg.claude_code_version as string | undefined,
          cwd: msg.cwd as string | undefined,
          tools: msg.tools as string[] | undefined,
          mcpServers: msg.mcp_servers as string[] | undefined,
          permissionMode: msg.permissionMode as string | undefined,
          apiKeySource: msg.apiKeySource as string | undefined,
          slashCommands: msg.slash_commands as string[] | undefined,
          agents: msg.agents as string[] | undefined,
        };

        return {
          type: 'init',
          sessionId: msg.session_id as string,
          systemInfo,
        };
      }
      return { type: 'init' };

    case 'assistant': {
      // Extract content blocks from message
      const msgContent = msg.message as Record<string, unknown> | undefined;
      const contentBlocks = msgContent?.content as Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      }> | undefined;

      if (!contentBlocks || contentBlocks.length === 0) {
        return { type: 'assistant', content: '' };
      }

      // Process all content blocks and generate multiple messages if needed
      const messages: ClaudeMessage[] = [];

      for (const block of contentBlocks) {
        if (block.type === 'text' && block.text) {
          // Text content
          messages.push({
            type: 'assistant',
            content: block.text,
          });
        } else if (block.type === 'tool_use') {
          // Tool use block - Claude is calling a tool
          messages.push({
            type: 'tool_use',
            toolUseId: block.id,
            toolName: block.name,
            toolInput: block.input,
          });
        }
      }

      // If no messages were generated, return empty assistant message
      if (messages.length === 0) {
        return { type: 'assistant', content: '' };
      }

      // If only one message, return it directly; otherwise return array
      return messages.length === 1 ? messages[0] : messages;
    }

    case 'user': {
      // Handle user type messages - these may contain tool_result blocks
      const userMsgContent = msg.message as Record<string, unknown> | undefined;
      const userContentBlocks = userMsgContent?.content as Array<{
        type: string;
        text?: string;
        tool_use_id?: string;
        content?: unknown;
        is_error?: boolean;
      }> | undefined;

      if (!userContentBlocks || userContentBlocks.length === 0) {
        return { type: 'assistant', content: '' };
      }

      const messages: ClaudeMessage[] = [];

      for (const block of userContentBlocks) {
        if (block.type === 'text' && block.text) {
          // Text content - return as assistant message
          messages.push({
            type: 'assistant',
            content: block.text,
          });
        } else if (block.type === 'tool_result') {
          // Tool result block - result from a tool execution
          messages.push({
            type: 'tool_result',
            toolUseId: block.tool_use_id,
            toolResult: block.content,
            isToolError: block.is_error,
          });
        }
      }

      // If no messages were generated, return empty assistant message
      if (messages.length === 0) {
        return { type: 'assistant', content: '' };
      }

      return messages.length === 1 ? messages[0] : messages;
    }

    case 'result':
      // Check if result has content (some commands return content in result)
      const resultContent = (msg as { result?: string }).result;
      if (resultContent) {
        return {
          type: 'result',
          content: resultContent,
          isComplete: true,
          usage: (msg as { usage?: { input_tokens: number; output_tokens: number } }).usage
            ? {
                inputTokens: (msg as { usage: { input_tokens: number } }).usage.input_tokens,
                outputTokens: (msg as { usage: { output_tokens: number } }).usage.output_tokens,
              }
            : undefined,
        };
      }
      return {
        type: 'result',
        isComplete: true,
        usage: (msg as { usage?: { input_tokens: number; output_tokens: number } }).usage
          ? {
              inputTokens: (msg as { usage: { input_tokens: number } }).usage.input_tokens,
              outputTokens: (msg as { usage: { output_tokens: number } }).usage.output_tokens,
            }
          : undefined,
      };

    default:
      // Log unknown message types for debugging
      console.log('[Claude SDK] Unknown message:', JSON.stringify(msg, null, 2));
      return {
        type: 'assistant',
        content: '',
      };
  }
}

/**
 * Create a Claude provider adapter from a ProviderConfig
 */
export function createClaudeAdapter(provider: ProviderConfig) {
  return {
    async *run(
      input: string,
      cwd: string,
      sessionId?: string,
      onPermissionRequest?: PermissionCallback
    ) {
      const options: ClaudeRunOptions = {
        cwd,
        sessionId,
        cliPath: provider.cliPath,
        env: provider.env,
      };

      yield* runClaude(input, options, onPermissionRequest);
    },
  };
}
