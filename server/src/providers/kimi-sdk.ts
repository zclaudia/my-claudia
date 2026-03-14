import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import type { MessageInput } from '@my-claudia/shared';
import type { ClaudeMessage, SystemInfo, PermissionCallback } from './claude-sdk.js';
import { buildNonImageAttachmentNotes } from './attachment-utils.js';


// ── Types ─────────────────────────────────────────────────────

export interface KimiRunOptions {
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  env?: Record<string, string>;
  model?: string;
  mode?: string;  // 'default' | 'plan' | 'yolo'
  systemPrompt?: string;
  thinking?: boolean;
}

// ── Tool call mapping ────────────────────────────────────────

const KIMI_TOOL_MAP: Record<string, string> = {
  read: 'Read',
  edit: 'Edit',
  bash: 'Bash',
  shell: 'Bash',
  grep: 'Grep',
  search: 'Grep',
  file_search: 'Grep',
  ls: 'View',
  view: 'View',
  glob: 'Glob',
  mcp: 'MCP',
};

interface KimiToolCall {
  tool: string;
  input: Record<string, unknown>;
}

function extractTextContent(value: unknown, depth = 0): string | undefined {
  if (value == null || depth > 5) return undefined;

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (Array.isArray(value)) {
    const parts = value
      .map((item) => extractTextContent(item, depth + 1))
      .filter((item): item is string => Boolean(item && item.length > 0));
    return parts.length > 0 ? parts.join('') : undefined;
  }

  if (typeof value !== 'object') return undefined;

  const record = value as Record<string, unknown>;

  for (const key of ['text', 'content', 'delta']) {
    const extracted = extractTextContent(record[key], depth + 1);
    if (extracted) return extracted;
  }

  if (record.message && typeof record.message === 'object') {
    const extracted = extractTextContent(record.message, depth + 1);
    if (extracted) return extracted;
  }

  if (record.type === 'text' || record.type === 'output_text' || record.type === 'text_delta') {
    const extracted = extractTextContent(record.text ?? record.content ?? record.delta, depth + 1);
    if (extracted) return extracted;
  }

  return undefined;
}

function extractAssistantText(event: Record<string, unknown>): string | undefined {
  return extractTextContent(
    event.content
      ?? event.text
      ?? event.delta
      ?? event.message
      ?? event.output
  );
}

function isThinkingEvent(event: Record<string, unknown>): boolean {
  const role = event.role as string | undefined;
  const type = event.type as string | undefined;
  const subtype = event.subtype as string | undefined;

  return (
    event.thinking === true
    || event.reasoning === true
    || type === 'thinking'
    || type === 'reasoning'
    || role === 'thinking'
    || subtype === 'thinking'
    || subtype === 'reasoning'
  );
}

function isToolLikeEvent(event: Record<string, unknown>): boolean {
  return Boolean(
    event.tool
    || event.tool_call
    || event.tool_use_id
    || event.call_id
    || event.function
    || event.args
    || event.arguments
  );
}

function isAssistantLikeEvent(event: Record<string, unknown>): boolean {
  const role = event.role as string | undefined;
  const sender = event.sender as string | undefined;
  const type = event.type as string | undefined;
  const subtype = event.subtype as string | undefined;

  if (role === 'assistant' || role === 'model' || role === 'thinking') return true;
  if (sender === 'assistant' || sender === 'model') return true;
  if (type && (type.includes('assistant') || type.includes('thinking') || type.includes('reasoning'))) return true;
  if (subtype && (subtype.includes('assistant') || subtype.includes('delta') || subtype === 'text')) return true;
  return false;
}

function parseToolInput(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return { input: value };
    }
  }

  return {};
}

function extractToolCall(event: Record<string, unknown>): KimiToolCall | null {
  const tool =
    (event.tool as string | undefined)
    || (event.name as string | undefined)
    || ((event.function as { name?: string } | undefined)?.name);
  if (!tool) return null;

  const mappedTool = KIMI_TOOL_MAP[tool] || tool;
  const rawInput =
    event.input
    ?? event.args
    ?? event.arguments
    ?? ((event.function as { arguments?: unknown } | undefined)?.arguments);
  const input = parseToolInput(rawInput);

  return { tool: mappedTool, input };
}

// ── Active processes (for abort) ─────────────────────────────

const activeProcesses = new Map<string, ChildProcess>();
const sessionToProcessKey = new Map<string, string>();

function bindSessionToProcess(sessionId: string | undefined, processKey: string): void {
  if (!sessionId) return;
  sessionToProcessKey.set(sessionId, processKey);
}

function unbindProcess(processKey: string): void {
  for (const [sessionId, key] of sessionToProcessKey.entries()) {
    if (key === processKey) {
      sessionToProcessKey.delete(sessionId);
    }
  }
}

// ── Input preparation ─────────────────────────────────────────

function prepareKimiInput(input: string): string {
  let messageInput: MessageInput;
  try {
    messageInput = JSON.parse(input);
    if (typeof messageInput !== 'object' || !('text' in messageInput)) {
      return input;
    }
  } catch {
    return input;
  }

  let text = messageInput.text || input;

  // Log unsupported attachments (image support can be added later)
  if (messageInput.attachments && messageInput.attachments.length > 0) {
    const imageCount = messageInput.attachments.filter((a) => a.type === 'image').length;
    if (imageCount > 0) {
      console.warn(`[Kimi SDK] ${imageCount} image attachment(s) not yet supported, sending text only`);
    }
    const nonImageNotes = buildNonImageAttachmentNotes(messageInput.attachments);
    if (nonImageNotes.length > 0) {
      text = `${nonImageNotes.join('\n\n')}\n\n${text}`;
    }
  }

  return text;
}

// ── Kimi event → ClaudeMessage mapping ───────────────────────

/**
 * 处理 Kimi CLI 新格式的事件，其中 content 是一个数组
 * 格式: {"role": "assistant", "content": [{"type": "think", "think": "..."}, {"type": "text", "text": "..."}]}
 */
function processContentArray(
  contentArray: Array<Record<string, unknown>>,
  inThinkBlock: boolean
): Array<{ msg: ClaudeMessage; updateThink?: boolean }> {
  const results: Array<{ msg: ClaudeMessage; updateThink?: boolean }> = [];
  let currentThinkBlock = inThinkBlock;

  for (const block of contentArray) {
    const blockType = block.type as string | undefined;

    switch (blockType) {
      case 'think': {
        // 思考内容块
        const thinkContent = (block.think as string) || (block.content as string) || '';
        if (thinkContent) {
          if (!currentThinkBlock) {
            results.push({
              msg: { type: 'assistant', content: `<think>${thinkContent}` },
              updateThink: true,
            });
            currentThinkBlock = true;
          } else {
            results.push({ msg: { type: 'assistant', content: thinkContent } });
          }
        }
        break;
      }

      case 'text': {
        // 文本内容块
        const textContent = (block.text as string) || (block.content as string) || '';
        if (textContent) {
          if (currentThinkBlock) {
            // 先关闭思考块
            results.push({ msg: { type: 'assistant', content: '</think>' }, updateThink: false });
            currentThinkBlock = false;
          }
          results.push({ msg: { type: 'assistant', content: textContent } });
        }
        break;
      }

      case 'tool_use':
      case 'tool_call': {
        // 工具调用
        const toolName = (block.name as string) || (block.tool as string) || '';
        const toolInput = (block.input as Record<string, unknown>) || (block.arguments as Record<string, unknown>) || {};
        if (toolName) {
          const mappedTool = KIMI_TOOL_MAP[toolName] || toolName;
          results.push({
            msg: {
              type: 'tool_use',
              toolName: mappedTool,
              toolInput,
              toolUseId: (block.id as string) || (block.tool_use_id as string) || crypto.randomUUID(),
            },
          });
        }
        break;
      }

      default: {
        // 未知类型，尝试提取文本
        const content = extractTextContent(block);
        if (content) {
          if (currentThinkBlock) {
            results.push({ msg: { type: 'assistant', content: '</think>' }, updateThink: false });
            currentThinkBlock = false;
          }
          results.push({ msg: { type: 'assistant', content } });
        }
      }
    }
  }

  return results;
}

function mapKimiEvent(
  event: Record<string, unknown>,
  inThinkBlock: boolean
): Array<{ msg: ClaudeMessage; updateThink?: boolean }> {
  const type = event.type as string | undefined;
  const role = event.role as string | undefined;
  const results: Array<{ msg: ClaudeMessage; updateThink?: boolean }> = [];

  // 处理新格式：没有 type 字段，但有 role 和 content 数组
  // 格式: {"role": "assistant", "content": [{"type": "think", ...}, {"type": "text", ...}]}
  if (!type && role === 'assistant' && Array.isArray(event.content)) {
    return processContentArray(
      event.content as Array<Record<string, unknown>>,
      inThinkBlock
    );
  }

  switch (type) {
    case 'init': {
      const systemInfo: SystemInfo = {
        model: event.model as string | undefined,
        cwd: event.cwd as string | undefined,
        tools: event.tools as string[] | undefined,
      };
      results.push({
        msg: {
          type: 'init',
          sessionId: (event.session_id as string) || (event.sessionId as string),
          systemInfo,
        },
      });
      break;
    }

    case 'system': {
      if (event.subtype === 'init') {
        const systemInfo: SystemInfo = {
          model: event.model as string | undefined,
          cwd: event.cwd as string | undefined,
          tools: event.tools as string[] | undefined,
        };
        results.push({
          msg: {
            type: 'init',
            sessionId: (event.session_id as string) || (event.sessionId as string),
            systemInfo,
          },
        });
      }
      break;
    }

    case 'message': {
      const role = event.role as string | undefined;
      const content = extractAssistantText(event);
      const isThinking = isThinkingEvent(event);
      let currentThinkState = inThinkBlock;

      if ((role === 'assistant' || role === 'model' || role === 'thinking') && content && !isToolLikeEvent(event)) {
        if (isThinking && !currentThinkState) {
          results.push({ msg: { type: 'assistant', content: `<think>${content}` }, updateThink: true });
          currentThinkState = true;
        } else if (!isThinking && currentThinkState) {
          results.push({ msg: { type: 'assistant', content: `</think>${content}` }, updateThink: false });
          currentThinkState = false;
        } else {
          results.push({ msg: { type: 'assistant', content } });
        }
      }
      if (event.is_complete === true || event.isComplete === true) {
        if (currentThinkState) {
          results.push({ msg: { type: 'assistant', content: '</think>' }, updateThink: false });
        }
        results.push({ msg: { type: 'result', isComplete: true } });
      }
      break;
    }

    case 'assistant':
    case 'assistant_delta':
    case 'content':
    case 'content_delta':
    case 'delta': {
      const content = extractAssistantText(event);
      const isThinking = isThinkingEvent(event);
      let currentThinkState = inThinkBlock;
      if (content && !isToolLikeEvent(event)) {
        if (isThinking && !currentThinkState) {
          results.push({ msg: { type: 'assistant', content: `<think>${content}` }, updateThink: true });
          currentThinkState = true;
        } else if (!isThinking && currentThinkState) {
          results.push({ msg: { type: 'assistant', content: `</think>${content}` }, updateThink: false });
          currentThinkState = false;
        } else {
          results.push({ msg: { type: 'assistant', content } });
        }
      }
      if (event.is_complete === true || event.isComplete === true) {
        if (currentThinkState) {
          results.push({ msg: { type: 'assistant', content: '</think>' }, updateThink: false });
        }
        results.push({ msg: { type: 'result', isComplete: true } });
      }
      break;
    }

    case 'thinking': {
      const thinkingContent = extractAssistantText(event);
      if (thinkingContent) {
        if (!inThinkBlock) {
          results.push({
            msg: { type: 'assistant', content: `<think>${thinkingContent}` },
            updateThink: true,
          });
        } else {
          results.push({ msg: { type: 'assistant', content: thinkingContent } });
        }
      }
      break;
    }

    case 'reasoning': {
      const reasoningContent = extractAssistantText(event);
      if (reasoningContent) {
        if (!inThinkBlock) {
          results.push({
            msg: { type: 'assistant', content: `<think>${reasoningContent}` },
            updateThink: true,
          });
        } else {
          results.push({ msg: { type: 'assistant', content: reasoningContent } });
        }
      }
      if (event.subtype === 'completed' && inThinkBlock) {
        results.push({ msg: { type: 'assistant', content: '</think>' }, updateThink: false });
      }
      break;
    }

    case 'tool_use': {
      const toolCall = extractToolCall(event);
      if (toolCall) {
        results.push({
          msg: {
            type: 'tool_use',
            toolName: toolCall.tool,
            toolInput: toolCall.input,
            toolUseId: (event.tool_use_id as string) || crypto.randomUUID(),
          },
        });
      }
      break;
    }

    case 'tool_call': {
      const toolCall = extractToolCall(
        (event.tool_call as Record<string, unknown> | undefined) || event
      );
      if (toolCall) {
        if (event.subtype === 'completed') {
          results.push({
            msg: {
              type: 'tool_result',
              toolName: toolCall.tool,
              toolResult: event.result ?? event.output ?? event.content,
              isToolError: event.error === true || event.status === 'error',
            },
          });
        } else {
          results.push({
            msg: {
              type: 'tool_use',
              toolName: toolCall.tool,
              toolInput: toolCall.input,
              toolUseId: (event.tool_use_id as string) || (event.call_id as string) || crypto.randomUUID(),
            },
          });
        }
      }
      break;
    }

    case 'tool_result': {
      const toolName =
        (event.tool as string | undefined)
        || (event.name as string | undefined)
        || ((event.function as { name?: string } | undefined)?.name);
      const result = event.result ?? event.output ?? event.content;
      const isError = event.error === true || event.status === 'error';

      if (toolName) {
        const mappedTool = KIMI_TOOL_MAP[toolName] || toolName;
        results.push({
          msg: {
            type: 'tool_result',
            toolName: mappedTool,
            toolResult: result,
            isToolError: isError,
          },
        });
      }
      break;
    }

    case 'error': {
      const errorMsg = event.message || event.error || 'Unknown error';
      results.push({ msg: { type: 'error', error: String(errorMsg) } });
      break;
    }

    case 'complete':
    case 'done': {
      // Close any open thinking block
      if (inThinkBlock) {
        results.push({ msg: { type: 'assistant', content: '</think>' }, updateThink: false });
      }
      results.push({ msg: { type: 'result', isComplete: true } });
      break;
    }

    case 'completed':
    case 'message_stop': {
      if (inThinkBlock) {
        results.push({ msg: { type: 'assistant', content: '</think>' }, updateThink: false });
      }
      results.push({ msg: { type: 'result', isComplete: true } });
      break;
    }

    default: {
      // Only surface unknown events when they clearly look like assistant text.
      const content = extractAssistantText(event);
      if (content && !isToolLikeEvent(event) && isAssistantLikeEvent(event)) {
        results.push({ msg: { type: 'assistant', content } });
      }
    }
  }

  return results;
}

// ── Main run function ─────────────────────────────────────────

export async function* runKimi(
  input: string,
  options: KimiRunOptions,
  _onPermission: PermissionCallback
): AsyncGenerator<ClaudeMessage, void, void> {
  let promptText = prepareKimiInput(input);
  const binary = options.cliPath || 'kimi';

  // 🆕 Handle systemPrompt: prepend to input
  // Kimi CLI doesn't have native systemPrompt support, so we prepend to the input
  if (options.systemPrompt) {
    const systemContext = `[System Context]\n${options.systemPrompt}`;
    promptText = `${systemContext}\n\n${promptText}`;
    console.log(`[Kimi SDK] Prepended system prompt (${options.systemPrompt.length} chars)`);
  }

  // Build CLI args
  // --print: Run in print mode (non-interactive)
  // --output-format stream-json: Stream JSON output
  // --yolo: Auto-approve all actions
  const args: string[] = [
    '--print',
    '--output-format',
    'stream-json',
    '--prompt',
    promptText,
  ];

  // Add yolo mode for non-interactive operation (unless explicitly disabled)
  if (options.mode !== 'ask') {
    args.push('--yolo');
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  if (options.thinking) {
    args.push('--thinking');
  }

  // Session resumption
  if (options.sessionId) {
    args.push('--session', options.sessionId);
  }

  // Work directory
  args.push('--work-dir', options.cwd);

  // Environment setup - filter out model-related env vars to ensure UI selection takes precedence
  const baseEnv = { ...process.env, ...(options.env || {}) };
  const { ANTHROPIC_MODEL, OPENAI_MODEL, MODEL, KIMI_INTERACTIVE, ...env } = baseEnv as Record<string, string>;

  let proc: ChildProcess;
  try {
    proc = spawn(binary, args, {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: 'error', error: `Failed to start kimi: ${msg}` };
    return;
  }

  // Store for abort
  const processKey = `kimi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  activeProcesses.set(processKey, proc);
  bindSessionToProcess(options.sessionId, processKey);

  // Capture spawn errors
  let spawnError: Error | null = null;
  proc.on('error', (err) => {
    spawnError = err;
  });

  if (!proc.stdout) {
    const err = spawnError as NodeJS.ErrnoException | null;
    activeProcesses.delete(processKey);
    unbindProcess(processKey);
    if (err?.code === 'ENOENT') {
      yield {
        type: 'error',
        error: 'kimi not found. Install it from https://github.com/moonshotai/kimi-cli',
      };
    } else {
      yield { type: 'error', error: err?.message || 'kimi process stdout is unavailable' };
    }
    return;
  }

  const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });

  // Log stderr for debugging
  if (proc.stderr) {
    proc.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        console.error('[Kimi SDK] stderr:', text);
      }
    });
  }

  let inThinkBlock = false;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        // Not JSON - treat as plain text output
        yield { type: 'assistant', content: line };
        continue;
      }

      const msgs = mapKimiEvent(event, inThinkBlock);
      for (const { msg, updateThink } of msgs) {
        if (msg.type === 'init' && msg.sessionId) {
          bindSessionToProcess(msg.sessionId, processKey);
        }
        if (updateThink !== undefined) inThinkBlock = updateThink;
        yield msg;
      }
    }

    // Close any dangling think block
    if (inThinkBlock) {
      yield { type: 'assistant', content: '</think>' };
    }

    // Check for spawn error after readline closes
    if (spawnError) {
      const err = spawnError as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        yield {
          type: 'error',
          error: `kimi not found. Install it from https://github.com/moonshotai/kimi-cli`,
        };
      } else {
        yield { type: 'error', error: `kimi error: ${err.message}` };
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    yield { type: 'error', error: `kimi execution error: ${message}` };
  } finally {
    activeProcesses.delete(processKey);
    unbindProcess(processKey);
    rl.close();
    proc.kill();
  }
}

// ── Abort function ────────────────────────────────────────────

export async function abortKimiSession(sessionId: string): Promise<void> {
  const processKey = sessionToProcessKey.get(sessionId) || sessionId;
  const proc = activeProcesses.get(processKey);
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete(processKey);
    unbindProcess(processKey);

    // Give it a moment to terminate gracefully
    await new Promise((resolve) => setTimeout(resolve, 500));

    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  }
}

// ── Adapter factory (for compatibility with existing code) ─────

export function createKimiAdapter(options: KimiRunOptions) {
  return {
    async *run(
      input: string,
      onPermission: PermissionCallback
    ): AsyncGenerator<ClaudeMessage, void, void> {
      yield* runKimi(input, options, onPermission);
    },
    abort: () => abortKimiSession(options.sessionId || ''),
  };
}
