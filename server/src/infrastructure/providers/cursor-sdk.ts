import { spawn } from 'child_process';
import { createInterface } from 'readline';
import path from 'path';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import type { ClaudeMessage, SystemInfo, PermissionCallback } from './message-types.js';
import { parseMessageInput, prependNonImageNotes } from './provider-input.js';
import { sanitizeInheritedProviderEnv } from '../../utils/startup-env.js';
import { getGlobalProcessSupervisor } from '../services/process-supervisor.js';
import { buildMcpBridgeEntry } from '../../utils/mcp-bridge-launch.js';
import { fileStore } from '../storage/fileStore.js';
import type { ToolEffect } from '@my-claudia/shared/core/message';
import { fileChangeEffectFromInput, makeShellEffect } from './tool-effects.js';

// ── Types ─────────────────────────────────────────────────────

export interface CursorRunOptions {
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  env?: Record<string, string>;
  model?: string;
  mode?: string;  // 'default' | 'plan' | 'ask'
  systemPrompt?: string;
  serverPort?: number;        // For MCP bridge injection
  claudiaSessionId?: string;  // Session context for interaction tools
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
  effect?: ToolEffect;
}

// ── Cursor-specific plan-mode semantics ──────────────────────
//
// cursor-agent owns two native tools we need to surface to the common UX:
//   - `switchMode`  → flips the session into/out of plan mode
//   - `createPlan`  → emits a markdown plan proposal while in plan mode
//
// The cursor SDK is the only place that knows these names. It normalizes them
// into the provider-agnostic `toolSemantic` tag (for UI rendering) and
// `mode_transition` event (for runtime mode state) so nothing downstream
// branches on provider type or cursor-specific tool names.

function detectCursorToolSemantic(
  toolName: string,
  args: unknown,
): 'plan_enter' | 'plan_exit' | 'plan_proposal' | undefined {
  if (toolName === 'createPlan') return 'plan_proposal';
  if (toolName === 'switchMode') {
    const target = readSwitchModeTarget(args);
    if (target === 'plan') return 'plan_enter';
    if (target) return 'plan_exit';
  }
  return undefined;
}

function deriveCursorModeTransition(
  toolName: string,
  args: unknown,
  sourceToolUseId: string | undefined,
): { mode: string; reason: 'enter' | 'exit'; sourceToolUseId?: string; plan?: string } | undefined {
  if (toolName !== 'switchMode') return undefined;
  const target = readSwitchModeTarget(args);
  if (!target) return undefined;
  return {
    mode: target === 'plan' ? 'plan' : 'default',
    reason: target === 'plan' ? 'enter' : 'exit',
    sourceToolUseId,
  };
}

function readSwitchModeTarget(args: unknown): string | undefined {
  if (!args || typeof args !== 'object') return undefined;
  const record = args as Record<string, unknown>;
  const candidates = ['targetModeId', 'targetMode', 'mode'];
  for (const key of candidates) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
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

    let effect: ToolEffect | undefined;
    if (toolName === 'Edit') {
      effect = fileChangeEffectFromInput(tc.args, 'modify');
    } else if (toolName === 'Bash') {
      const args = tc.args && typeof tc.args === 'object' ? tc.args as Record<string, unknown> : {};
      effect = makeShellEffect(typeof args.command === 'string' ? args.command : undefined);
    }

    return { toolName, args: tc.args, result, effect };
  }
  return null;
}

// ── MCP Bridge injection ─────────────────────────────────────

function injectCursorMcpBridge(options: CursorRunOptions): void {
  // Session ID file for dynamic session tracking (cursor-agent loads MCP once at startup,
  // but bridge reads session ID from file on each tool call)
  const configDir = path.join(tmpdir(), 'my-claudia-mcp');
  mkdirSync(configDir, { recursive: true });
  const sessionIdFile = path.join(configDir, `cursor-session-${options.serverPort}.txt`);
  if (options.claudiaSessionId) {
    writeFileSync(sessionIdFile, options.claudiaSessionId);
  }

  const bridgeEntry = buildMcpBridgeEntry(options.serverPort!, undefined, sessionIdFile);
  if (!bridgeEntry) return;

  // Read existing .cursor/mcp.json (merge, don't overwrite)
  const mcpJsonPath = path.join(options.cwd, '.cursor', 'mcp.json');
  let config: Record<string, unknown> = {};
  try {
    if (existsSync(mcpJsonPath)) {
      config = JSON.parse(readFileSync(mcpJsonPath, 'utf-8'));
    }
  } catch { /* start fresh */ }

  const mcpServers = (config.mcpServers || {}) as Record<string, unknown>;
  mcpServers['claudia-plugins'] = bridgeEntry;
  config.mcpServers = mcpServers;

  mkdirSync(path.join(options.cwd, '.cursor'), { recursive: true });
  writeFileSync(mcpJsonPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`[Cursor SDK] Injected MCP bridge into ${mcpJsonPath}`);
}

// ── Active processes (for abort) ──────────────────────────────

const activeProcesses = new Map<string, ReturnType<typeof spawn>>();

// ── Input preparation ─────────────────────────────────────────

function prepareCursorInput(input: string): string {
  const parsed = parseMessageInput(input);
  if (!parsed) return input;

  let text = parsed.text;

  if (parsed.attachments.length > 0) {
    const imageRefs: string[] = [];

    for (const attachment of parsed.attachments) {
      if (attachment.type !== 'image') continue;

      const filePath = fileStore.getFilePath(attachment.fileId);
      if (filePath) {
        imageRefs.push(filePath);
        console.log(`[Cursor SDK] Referencing image ${attachment.name} → ${filePath}`);
      } else {
        console.warn(`[Cursor SDK] Could not locate image ${attachment.fileId}, skipping`);
      }
    }

    if (imageRefs.length > 0) {
      const refs = imageRefs
        .map((filePath) => `[Attached image: ${filePath}]`)
        .join('\n');
      text = `${refs}\n\n${text}`;
    }

    text = prependNonImageNotes(text, parsed.attachments);
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

  // Inject MCP bridge into .cursor/mcp.json before spawning
  if (options.serverPort) {
    injectCursorMcpBridge(options);
  }

  // Filter out model-related env vars to ensure UI model selection takes precedence
  const baseEnv = { ...process.env, ...(options.env || {}) };
  sanitizeInheritedProviderEnv(baseEnv);
  const env = baseEnv;

  let proc: ReturnType<typeof spawn>;
  try {
    proc = spawn(binary, args, {
      cwd: options.cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    getGlobalProcessSupervisor()?.observeChildProcess({
      source: 'provider_run',
      command: binary,
      args,
      cwd: options.cwd,
      owner: {
        sessionId: options.claudiaSessionId ?? options.sessionId,
      },
      tags: ['provider:cursor'],
    }, proc);
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

  // Collect stderr error messages to surface to the user if stdout produces no useful output
  const stderrErrors: string[] = [];
  proc.stderr!.on('data', (chunk: Buffer) => {
    const text = chunk.toString().trim();
    if (text) {
      console.error('[Cursor SDK] stderr:', text);
      // Capture CLI-level error/warning/info messages (e.g. usage cap, model blocked)
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('I:') || trimmed.startsWith('E:') || trimmed.startsWith('W:')) {
          stderrErrors.push(trimmed);
        }
      }
    }
  });

  let inThinkBlock = false;
  let hasUsefulOutput = false;

  try {
    for await (const line of rl) {
      if (!line.trim()) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line);
      } catch {
        // Non-JSON output from cursor-agent is typically a CLI-level error
        // (e.g. "I: Model Blocked ...", "E: ...", "W: ...")
        // Surface as provider error so the run terminates and the user sees the message.
        const trimmed = line.trim();
        if (trimmed.startsWith('I:') || trimmed.startsWith('E:') || trimmed.startsWith('W:')) {
          console.error('[Cursor SDK] CLI message:', trimmed);
          yield { type: 'error', error: trimmed } as ClaudeMessage;
        } else {
          console.warn('[Cursor SDK] Failed to parse JSON line:', line.slice(0, 200));
        }
        continue;
      }

      const msgs = mapCursorEvent(event, inThinkBlock);
      for (const { msg, updateThink } of msgs) {
        if (updateThink !== undefined) inThinkBlock = updateThink;
        if (msg.type === 'assistant' || msg.type === 'tool_use' || msg.type === 'result') {
          hasUsefulOutput = true;
        }
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

    // Surface stderr errors if cursor-agent produced no useful output
    // (e.g. usage cap hit, model blocked — these only appear on stderr)
    if (!hasUsefulOutput && stderrErrors.length > 0) {
      for (const errMsg of stderrErrors) {
        yield { type: 'error', error: errMsg } as ClaudeMessage;
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

      const semantic = detectCursorToolSemantic(info.toolName, info.args);

      if (evSubtype === 'started') {
        results.push({
          msg: {
            type: 'tool_use',
            toolUseId: callId,
            toolName: info.toolName,
            toolInput: info.args,
            toolSemantic: semantic,
            toolEffect: info.effect,
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

        // After a successful mode-switching tool completes, normalize to the
        // shared mode_transition event so the runtime stays provider-agnostic.
        const transition = deriveCursorModeTransition(info.toolName, info.args, callId);
        if (transition) {
          results.push({ msg: { type: 'mode_transition', modeTransition: transition } });
        }
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
  activeProcesses.delete(sessionId);
  if (proc) {
    proc.kill('SIGTERM');
    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!proc.killed) {
      proc.kill('SIGKILL');
    }
  }
}
