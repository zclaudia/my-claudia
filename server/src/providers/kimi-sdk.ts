import { spawn, type ChildProcess } from 'child_process';
import { createInterface } from 'readline';
import type { MessageInput } from '@my-claudia/shared';
import type { ClaudeMessage, SystemInfo, PermissionCallback } from './claude-sdk.js';
import { buildNonImageAttachmentNotes } from './attachment-utils.js';
import { getKimiSubscriptionInfoHint } from './subscription-usage.js';

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

function extractToolCall(event: Record<string, unknown>): KimiToolCall | null {
  const tool = event.tool as string | undefined;
  if (!tool) return null;

  const mappedTool = KIMI_TOOL_MAP[tool] || tool;
  const input = (event.input as Record<string, unknown>) || {};

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

function mapKimiEvent(
  event: Record<string, unknown>,
  inThinkBlock: boolean
): Array<{ msg: ClaudeMessage; updateThink?: boolean }> {
  const type = event.type as string | undefined;
  const results: Array<{ msg: ClaudeMessage; updateThink?: boolean }> = [];

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

    case 'message': {
      const role = event.role as string | undefined;
      const content = event.content as string | undefined;
      const isThinking = event.thinking === true || event.type === 'thinking';

      if (role === 'assistant' && content) {
        if (isThinking && !inThinkBlock) {
          results.push({ msg: { type: 'assistant', content: `<think>${content}` }, updateThink: true });
        } else if (!isThinking && inThinkBlock) {
          results.push({ msg: { type: 'assistant', content: `</think>${content}` }, updateThink: false });
        } else {
          results.push({ msg: { type: 'assistant', content } });
        }
      }
      break;
    }

    case 'thinking': {
      const thinkingContent = event.content as string | undefined;
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

    case 'tool_result': {
      const toolName = event.tool as string | undefined;
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

    default: {
      // Try to handle unknown events gracefully
      if (event.content && typeof event.content === 'string') {
        results.push({ msg: { type: 'assistant', content: event.content } });
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
  const subscriptionInfo = getKimiSubscriptionInfoHint();
  const promptText = prepareKimiInput(input);
  const binary = options.cliPath || 'kimi';

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

  // Environment setup
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...(options.env || {}),
  };

  // Remove KIMI env vars that might cause conflicts
  delete (env as Record<string, unknown>).KIMI_INTERACTIVE;

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
          msg.systemInfo = {
            ...(msg.systemInfo || {}),
            subscription: subscriptionInfo,
          };
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
