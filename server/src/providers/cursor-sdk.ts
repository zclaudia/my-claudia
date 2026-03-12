import { spawn } from 'child_process';
import { createInterface } from 'readline';
import type { MessageInput } from '@my-claudia/shared';
import type { ClaudeMessage, SystemInfo, PermissionCallback } from './claude-sdk.js';
import { buildNonImageAttachmentNotes } from './attachment-utils.js';

// ── Types ─────────────────────────────────────────────────────

export interface CursorRunOptions {
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  env?: Record<string, string>;
  model?: string;
  mode?: string;  // 'default' | 'plan' | 'ask'
  systemPrompt?: string;
}

// ── Tool call key → friendly name mapping ────────────────────

const TOOL_CALL_KEY_MAP: Record<string, string> = {
  editToolCall: 'Edit',
  shellToolCall: 'Bash',   // cursor-agent uses shellToolCall for bash commands
  bashToolCall: 'Bash',    // keep for forward-compat
  readToolCall: 'Read',
  searchToolCall: 'Grep',
  lspToolCall: 'LSP',
  mcpToolCall: 'MCP',
};

interface ToolCallInfo {
  toolName: string;
  args: unknown;
  result?: unknown;
}

function extractToolCall(toolCallObj: Record<string, unknown>): ToolCallInfo | null {
  for (const key of Object.keys(toolCallObj)) {
    const tc = toolCallObj[key] as { args?: unknown; result?: unknown } | undefined;
    if (!tc) continue;
    const toolName = TOOL_CALL_KEY_MAP[key] || key.replace(/ToolCall$/, '');

    // Extract a human-readable result from nested success/failure structures
    let result = tc.result;
    if (result && typeof result === 'object') {
      const r = result as Record<string, unknown>;
      if (r.success) {
        const s = r.success as Record<string, unknown>;
        // Shell: prefer stdout, fallback to message
        result = s.stdout ?? s.interleavedOutput ?? s.message ?? JSON.stringify(r.success);
      } else if (r.rejected) {
        result = `Rejected: ${(r.rejected as Record<string, unknown>).reason || 'permission denied'}`;
      } else if (r.error) {
        result = String(r.error);
      }
    }

    return { toolName, args: tc.args, result };
  }
  return null;
}

// ── Active processes (for abort) ──────────────────────────────

const activeProcesses = new Map<string, ReturnType<typeof spawn>>();

// ── Input preparation ─────────────────────────────────────────

function prepareCursorInput(input: string): string {
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
    const imageCount = messageInput.attachments.filter(a => a.type === 'image').length;
    if (imageCount > 0) {
      console.warn(`[Cursor SDK] ${imageCount} image attachment(s) not yet supported, sending text only`);
    }
    const nonImageNotes = buildNonImageAttachmentNotes(messageInput.attachments);
    if (nonImageNotes.length > 0) {
      text = `${nonImageNotes.join('\n\n')}\n\n${text}`;
    }
  }

  return text;
}

// ── Main run function ─────────────────────────────────────────

export async function* runCursor(
  input: string,
  options: CursorRunOptions,
  _onPermission: PermissionCallback,
): AsyncGenerator<ClaudeMessage, void, void> {
  let promptText = prepareCursorInput(input);
  const binary = options.cliPath || 'cursor-agent';

  // 🆕 Handle systemPrompt: prepend to input
  // Cursor CLI doesn't have native systemPrompt support, so we prepend to the input
  if (options.systemPrompt) {
    const systemContext = `[System Context]\n${options.systemPrompt}`;
    promptText = `${systemContext}\n\n${promptText}`;
    console.log(`[Cursor SDK] Prepended system prompt (${options.systemPrompt.length} chars)`);
  }

  // Build CLI args
  // --trust: bypass workspace trust prompt (required for non-interactive operation)
  // --yolo:  bypass per-command approval (bash cmds auto-rejected in -p mode without this)
  const args: string[] = ['-p', promptText, '--output-format', 'stream-json', '--trust'];

  if (options.mode === 'plan') {
    args.push('--mode=plan');
  } else if (options.mode === 'ask') {
    args.push('--mode=ask');
  } else {
    // Agent/default mode: add --yolo so bash commands aren't auto-rejected in non-interactive mode
    args.push('--yolo');
  }

  if (options.model) {
    args.push('--model', options.model);
  }

  // Session resumption: options.sessionId IS the cursor session_id (stored as sdk_session_id in DB)
  if (options.sessionId) {
    args.push('--resume', options.sessionId);
  }

  // Filter out model-related env vars to ensure UI model selection takes precedence
  const baseEnv = { ...process.env, ...(options.env || {}) };
  const { ANTHROPIC_MODEL, OPENAI_MODEL, MODEL, ...env } = baseEnv;

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(binary, args, {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    yield { type: 'error', error: `Failed to start cursor-agent: ${msg}` };
    return;
  }

  if (options.sessionId) {
    activeProcesses.set(options.sessionId, proc);
  }

  // Capture spawn errors (e.g. ENOENT)
  let spawnError: Error | null = null;
  proc.on('error', (err) => {
    spawnError = err;
  });

  const rl = createInterface({ input: proc.stdout!, crlfDelay: Infinity });

  // Log stderr for debugging
  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      console.error('[Cursor SDK] stderr:', text);
    }
  });

  let inThinkBlock = false;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }

      const msgs = mapCursorEvent(event, inThinkBlock);
      for (const { msg, updateThink } of msgs) {
        if (updateThink !== undefined) inThinkBlock = updateThink;
        yield msg;
      }
    }

    // Close any dangling think block (shouldn't happen, but be safe)
    if (inThinkBlock) {
      yield { type: 'assistant', content: '</think>' };
    }

    // Check for spawn error after readline closes
    if (spawnError) {
      const err = spawnError as NodeJS.ErrnoException;
      if (err.code === 'ENOENT') {
        yield {
          type: 'error',
          error: `cursor-agent not found. Install it from https://cursor.com/cli`,
        };
      } else {
        yield { type: 'error', error: `cursor-agent error: ${err.message}` };
      }
    }
  } catch (err: unknown) {
    if (inThinkBlock) {
      yield { type: 'assistant', content: '</think>' };
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    yield { type: 'error', error: `Cursor error: ${errorMsg}` };
  } finally {
    rl.close();
    if (options.sessionId) {
      activeProcesses.delete(options.sessionId);
    }
  }
}

// ── Event mapping ─────────────────────────────────────────────

interface MappedEvent {
  msg: ClaudeMessage;
  updateThink?: boolean;
}

function mapCursorEvent(
  event: Record<string, unknown>,
  inThinkBlock: boolean,
): MappedEvent[] {
  const results: MappedEvent[] = [];
  const evType = event.type as string;
  const evSubtype = event.subtype as string | undefined;

  switch (evType) {
    case 'system': {
      if (evSubtype === 'init') {
        const systemInfo: SystemInfo = {
          model: event.model as string | undefined,
          cwd: event.cwd as string | undefined,
          apiKeySource: event.apiKeySource as string | undefined,
        };
        results.push({
          msg: { type: 'init', sessionId: event.session_id as string, systemInfo },
        });
      }
      break;
    }

    case 'user':
      // Echo of user input — skip
      break;

    case 'thinking': {
      if (evSubtype === 'delta') {
        const text = event.text as string;
        if (!inThinkBlock) {
          results.push({ msg: { type: 'assistant', content: '<think>' + text }, updateThink: true });
        } else {
          results.push({ msg: { type: 'assistant', content: text } });
        }
      } else if (evSubtype === 'completed' && inThinkBlock) {
        results.push({ msg: { type: 'assistant', content: '</think>' }, updateThink: false });
      }
      break;
    }

    case 'assistant': {
      // Close any open think block first
      if (inThinkBlock) {
        results.push({ msg: { type: 'assistant', content: '</think>' }, updateThink: false });
      }
      const message = event.message as {
        content?: Array<{ type: string; text?: string }>;
      } | undefined;
      if (message?.content) {
        for (const block of message.content) {
          if (block.type === 'text' && block.text) {
            results.push({ msg: { type: 'assistant', content: block.text } });
          }
        }
      }
      break;
    }

    case 'tool_call': {
      // cursor-agent emits {type:'tool_call', subtype:'started'|'completed', call_id, tool_call:{...ToolCall}}
      const callId = event.call_id as string | undefined;
      const toolCallObj = event.tool_call as Record<string, unknown> | undefined;
      if (!toolCallObj) break;

      const info = extractToolCall(toolCallObj);
      if (!info) break;

      if (evSubtype === 'started') {
        results.push({
          msg: {
            type: 'tool_use',
            toolUseId: callId,
            toolName: info.toolName,
            toolInput: info.args,
          },
        });
      } else if (evSubtype === 'completed') {
        const resultStr = info.result
          ? (typeof info.result === 'string' ? info.result : JSON.stringify(info.result))
          : 'Done';
        results.push({
          msg: {
            type: 'tool_result',
            toolUseId: callId,
            toolResult: resultStr,
          },
        });
      }
      break;
    }

    case 'result': {
      const usage = event.usage as {
        inputTokens?: number;
        outputTokens?: number;
      } | undefined;

      if (evSubtype === 'error' || event.is_error) {
        const errMsg = (event.result as string) || 'cursor-agent returned an error';
        results.push({ msg: { type: 'error', error: errMsg } });
      } else {
        results.push({
          msg: {
            type: 'result',
            isComplete: true,
            usage: usage
              ? { inputTokens: usage.inputTokens || 0, outputTokens: usage.outputTokens || 0 }
              : undefined,
          },
        });
      }
      break;
    }

    default:
      console.log(`[Cursor SDK] Unhandled event type: ${evType}`, JSON.stringify(event));
  }

  return results;
}

// ── Abort ─────────────────────────────────────────────────────

export async function abortCursorSession(sessionId: string): Promise<void> {
  const proc = activeProcesses.get(sessionId);
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete(sessionId);
  }
}
