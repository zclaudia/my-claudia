import { query } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';
import type { ProviderConfig, PermissionRequest, PermissionMode, MessageInput, MessageAttachment } from '@my-claudia/shared';
import { fileStore } from '../storage/fileStore.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

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

// ── Temp file utilities for image attachments ──────────────────

const UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'claudia-uploads');

function ensureTmpDir() {
  if (!fs.existsSync(UPLOAD_TMP_DIR)) {
    fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  }
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/bmp': 'bmp',
  };
  return map[mimeType] || 'png';
}

export function cleanupTempFiles(files: string[]) {
  for (const f of files) {
    try { fs.unlinkSync(f); } catch { /* ignore */ }
  }
}

interface PreparedInput {
  text: string;
  tempFiles: string[];
}

/**
 * Parse MessageInput, save image attachments to temp files,
 * and return prompt text with file references.
 *
 * Claude CLI's Read tool is multimodal — it can read image files natively.
 * By saving images to disk and referencing them in the prompt, the CLI
 * will use its Read tool to view the images.
 */
export async function prepareInput(input: string): Promise<PreparedInput> {
  let messageInput: MessageInput;
  try {
    messageInput = JSON.parse(input);
    if (typeof messageInput !== 'object' || !('text' in messageInput)) {
      return { text: input, tempFiles: [] };
    }
  } catch {
    return { text: input, tempFiles: [] };
  }

  // No attachments — just return the text
  if (!messageInput.attachments || messageInput.attachments.length === 0) {
    return { text: messageInput.text || input, tempFiles: [] };
  }

  const tempFiles: string[] = [];
  const imageRefs: string[] = [];

  ensureTmpDir();

  for (const attachment of messageInput.attachments) {
    if (attachment.type === 'image') {
      const fileData = await getFileData(attachment.fileId);
      if (fileData) {
        const ext = mimeToExt(attachment.mimeType);
        const fileName = `${crypto.randomUUID()}.${ext}`;
        const filePath = path.join(UPLOAD_TMP_DIR, fileName);

        fs.writeFileSync(filePath, Buffer.from(fileData, 'base64'));
        tempFiles.push(filePath);
        imageRefs.push(filePath);
        console.log(`[Claude SDK] Saved image ${attachment.name} → ${filePath}`);
      } else {
        console.warn(`[Claude SDK] Could not load image ${attachment.fileId}, skipping`);
      }
    }
  }

  // Build prompt text with image file references
  let text = messageInput.text || '';
  if (imageRefs.length > 0) {
    const refs = imageRefs
      .map(p => `[Attached image: ${p}]`)
      .join('\n');
    text = `${refs}\n\n${text}`;
  }

  return { text, tempFiles };
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
    sdkOptions.pathToClaudeCodeExecutable = options.cliPath;
  }

  // Set custom environment variables (for multi-config support)
  // Remove CLAUDECODE env var to prevent nested session detection
  if (options.env) {
    const cleanEnv = { ...options.env };
    delete (cleanEnv as Record<string, unknown>).CLAUDECODE;
    sdkOptions.env = cleanEnv;
  }

  // Permission handling callback
  if (onPermissionRequest) {
    sdkOptions.canUseTool = async (
      toolName: string,
      toolInput: Record<string, unknown>,
      _context: { signal: AbortSignal; toolUseID: string; [key: string]: unknown }
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

      // Auto-approve Read for temp upload files (user-uploaded images)
      if (toolName === 'Read' && typeof toolInput === 'object' && toolInput !== null) {
        const filePath = (toolInput as Record<string, unknown>).file_path;
        if (typeof filePath === 'string' && filePath.startsWith(UPLOAD_TMP_DIR + '/')) {
          return { behavior: 'allow', updatedInput: toolInput };
        }
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
  const { text: promptText, tempFiles } = await prepareInput(input);

  // Grant CLI access to temp upload directory so it can read attached images
  if (tempFiles.length > 0) {
    sdkOptions.additionalDirectories = [UPLOAD_TMP_DIR];
  }

  try {
    // Start the query
    const queryInstance = query({
      prompt: promptText,
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
  } finally {
    // Clean up temp files after run completes (or fails)
    if (tempFiles.length > 0) {
      cleanupTempFiles(tempFiles);
      console.log(`[Claude SDK] Cleaned up ${tempFiles.length} temp file(s)`);
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

// ── Dynamic model discovery ────────────────────────────────────

let cachedModels: ModelInfo[] | null = null;
let cacheTimestamp = 0;
const MODEL_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch available Claude models from the CLI via SDK's supportedModels() API.
 * Results are cached for 10 minutes to avoid spawning CLI processes repeatedly.
 */
export async function fetchClaudeModels(
  cliPath?: string,
  env?: Record<string, string>
): Promise<ModelInfo[]> {
  if (cachedModels && Date.now() - cacheTimestamp < MODEL_CACHE_TTL) {
    return cachedModels;
  }

  const sdkOptions: Record<string, unknown> = {
    cwd: process.cwd(),
    maxTurns: 1,
  };
  if (cliPath) sdkOptions.pathToClaudeCodeExecutable = cliPath;

  // Build env without CLAUDECODE to prevent nested session detection
  const cleanEnv = { ...(env || process.env) };
  delete (cleanEnv as Record<string, unknown>).CLAUDECODE;
  sdkOptions.env = cleanEnv;

  const abortController = new AbortController();
  sdkOptions.abortController = abortController;

  const queryInstance = query({
    prompt: 'hi',
    options: sdkOptions,
  });

  try {
    const models = await queryInstance.supportedModels();
    cachedModels = models;
    cacheTimestamp = Date.now();
    console.log(`[Claude SDK] Fetched ${models.length} models from CLI`);
    return models;
  } catch (error) {
    console.error('[Claude SDK] Failed to fetch models:', error);
    return [];
  } finally {
    abortController.abort();
  }
}

// ── Dynamic command discovery ──────────────────────────────────

interface SdkSlashCommand {
  name: string;
  description: string;
  argumentHint: string;
}

let cachedCommands: SdkSlashCommand[] | null = null;
let commandCacheTimestamp = 0;
const COMMAND_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Fetch available Claude slash commands from the CLI via SDK's supportedCommands() API.
 * Results are cached for 10 minutes to avoid spawning CLI processes repeatedly.
 */
export async function fetchClaudeCommands(
  cliPath?: string,
  env?: Record<string, string>
): Promise<SdkSlashCommand[]> {
  if (cachedCommands && Date.now() - commandCacheTimestamp < COMMAND_CACHE_TTL) {
    return cachedCommands;
  }

  const sdkOptions: Record<string, unknown> = {
    cwd: process.cwd(),
    maxTurns: 1,
  };
  if (cliPath) sdkOptions.pathToClaudeCodeExecutable = cliPath;

  // Build env without CLAUDECODE to prevent nested session detection
  const cleanEnv = { ...(env || process.env) };
  delete (cleanEnv as Record<string, unknown>).CLAUDECODE;
  sdkOptions.env = cleanEnv;

  const abortController = new AbortController();
  sdkOptions.abortController = abortController;

  const queryInstance = query({
    prompt: 'hi',
    options: sdkOptions,
  });

  try {
    const commands = await queryInstance.supportedCommands();
    cachedCommands = commands as SdkSlashCommand[];
    commandCacheTimestamp = Date.now();
    console.log(`[Claude SDK] Fetched ${commands.length} commands from CLI`);
    return cachedCommands;
  } catch (error) {
    console.error('[Claude SDK] Failed to fetch commands:', error);
    return [];
  } finally {
    abortController.abort();
  }
}

/**
 * Check SDK and CLI version compatibility at startup.
 * Logs a warning if versions are significantly out of sync.
 */
export async function checkVersionCompatibility(cliPath?: string): Promise<void> {
  try {
    // Get SDK npm package version (ESM-compatible)
    const { createRequire } = await import('module');
    const require = createRequire(import.meta.url);
    const sdkPkgPath = require.resolve('@anthropic-ai/claude-agent-sdk/package.json');
    const sdkPkg = JSON.parse(fs.readFileSync(sdkPkgPath, 'utf-8'));
    const sdkVersion = sdkPkg.version as string;

    // Get CLI version via --version flag
    const { execSync } = await import('child_process');
    const cliExe = cliPath || 'claude';
    const cliOutput = execSync(`${cliExe} --version`, { encoding: 'utf-8', timeout: 5000 }).trim();
    // Output: "2.1.42 (Claude Code)"
    const cliVersionMatch = cliOutput.match(/^([\d.]+)/);
    const cliVersion = cliVersionMatch?.[1] || 'unknown';

    // Compare major versions
    const sdkMajor = parseInt(sdkVersion.split('.')[0] || '0');
    const cliMajor = parseInt(cliVersion.split('.')[0] || '0');

    console.log(`[Version Check] SDK: ${sdkVersion}, CLI: ${cliVersion}`);

    if (sdkMajor !== cliMajor && cliMajor > 0) {
      console.warn(`⚠️  [Version Check] Major version mismatch! SDK v${sdkVersion} vs CLI v${cliVersion}`);
      console.warn(`   Run: pnpm --filter @my-claudia/server update @anthropic-ai/claude-agent-sdk@latest`);
    }
  } catch (error) {
    // Non-fatal — don't block startup
    console.warn('[Version Check] Could not check version compatibility:', (error as Error).message);
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
