import { readFileSync } from 'fs';
import path from 'path';
import {
  Codex,
  type ThreadOptions,
  type ThreadEvent,
  type ThreadItem,
  type Input,
  type UserInput,
  type Usage as CodexUsage,
} from '@openai/codex-sdk';
import type { PermissionRequest } from '@my-claudia/shared/interaction/permissions';
import type Database from 'better-sqlite3';
import type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './claude-sdk.js';
import { fileStore } from '../storage/fileStore.js';
import { extractRetryDelayMsFromError } from '../../utils/retry-window.js';
import { parseMessageInput, prependNonImageNotes } from './provider-input.js';
import { sanitizeInheritedProviderEnv } from '../../utils/startup-env.js';
import { buildMcpBridgeEntry } from '../../utils/mcp-bridge-launch.js';
import { loadMcpServersFromDb } from '../../utils/mcp-config.js';
import {
  fileChangeEffectFromArray,
  fileChangeEffectFromSummaryText,
  makeShellEffect,
} from './tool-effects.js';


// ── Types ─────────────────────────────────────────────────────

export interface CodexRunOptions {
  cwd: string;
  sessionId?: string;       // Our session ID (maps to sdk_session_id = thread_id)
  cliPath?: string;         // codexPathOverride
  env?: Record<string, string>;
  model?: string;
  mode?: string;            // Our permission mode → approval + sandbox
  systemPrompt?: string;
  serverPort?: number;        // For MCP bridge injection
  claudiaSessionId?: string;  // Session context for interaction tools
  db?: Database.Database;
}

const MAX_AUTO_RETRIES = 3;

function isHardQuotaExceededError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes('insufficient_quota') ||
    msg.includes('quota exceeded') ||
    msg.includes('billing hard limit') ||
    msg.includes('billing limit') ||
    msg.includes('usage limit reached') ||
    msg.includes('credit balance') ||
    msg.includes('subscription quota') ||
    msg.includes('monthly limit reached')
  );
}

function isRetryableLimitError(errorMessage: string): boolean {
  if (isHardQuotaExceededError(errorMessage)) return false;
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('ratelimit') ||
    msg.includes('too many requests') ||
    msg.includes('429') ||
    msg.includes('retry-after')
  );
}

function isRetryableStreamError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes('stream disconnected') ||
    msg.includes('reconnecting') ||
    msg.includes('an error occurred while processing your request') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    msg.includes('network error') ||
    msg.includes('connection reset') ||
    msg.includes('unexpected end of') ||
    msg.includes('aborted') && !msg.includes('user')
  );
}

function isRetryableError(errorMessage: string): boolean {
  return isRetryableLimitError(errorMessage) || isRetryableStreamError(errorMessage);
}

function getBackoffDelayMs(attempt: number, isStreamError: boolean): number {
  if (isStreamError) {
    return 1000 * Math.pow(2, Math.max(0, attempt - 1)); // 1s, 2s, 4s — faster for transient errors
  }
  return 2000 * Math.pow(2, Math.max(0, attempt - 1)); // 2s, 4s, 8s
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Mode → Codex policy mapping ──────────────────────────────

function mapModeToPolicies(mode?: string): Pick<ThreadOptions, 'approvalPolicy' | 'sandboxMode'> {
  // Codex SDK does not expose approval request events, so interactive approval
  // (on-request / on-failure) is non-functional — the CLI waits for a reply that
  // never arrives.  Use 'never' for all modes and rely on sandboxMode for safety.
  switch (mode) {
    case 'plan':
      return { approvalPolicy: 'never', sandboxMode: 'read-only' };
    case 'bypassPermissions':
      return { approvalPolicy: 'never', sandboxMode: 'danger-full-access' };
    case 'acceptEdits':
      return { approvalPolicy: 'never', sandboxMode: 'workspace-write' };
    case 'default':
    default:
      return { approvalPolicy: 'never', sandboxMode: 'workspace-write' };
  }
}

// ── Input preparation (handle images) ────────────────────────

function prepareCodexInput(input: string): Input {
  const parsed = parseMessageInput(input);
  if (!parsed) return input;

  const text = prependNonImageNotes(parsed.text, parsed.attachments);
  if (parsed.attachments.length === 0) return text;

  const parts: UserInput[] = [{ type: 'text', text }];

  for (const attachment of parsed.attachments) {
    if (attachment.type === 'image') {
      const filePath = fileStore.getFilePath(attachment.fileId);
      if (filePath) {
        parts.push({ type: 'local_image', path: filePath });
        console.log(`[Codex] Attached image: ${attachment.name} → ${filePath}`);
      } else {
        console.warn(`[Codex] Could not locate image ${attachment.fileId}, skipping`);
      }
    }
  }

  return parts;
}

// ── MCP tool name normalization ───────────────────────────────
// Plan mode tools are registered as MCP tools (snake_case) but run-handler
// expects PascalCase names matching Claude SDK's native tools.
const MCP_PLAN_TOOL_MAP: Record<string, string> = {
  'enter_plan_mode': 'EnterPlanMode',
  'exit_plan_mode': 'ExitPlanMode',
};

function normalizeMcpToolName(server: string, tool: string): string {
  if (server === 'claudia-plugins') {
    const native = MCP_PLAN_TOOL_MAP[tool];
    if (native) return native;
  }
  return `mcp:${server}:${tool}`;
}

// ── Codex-specific plan-mode semantics ───────────────────────
//
// Codex injects plan-mode through the MCP bridge using the
// `enter_plan_mode` / `exit_plan_mode` tool names, which are normalized to
// `EnterPlanMode` / `ExitPlanMode` above. The codex SDK keeps that knowledge
// local: it tags outgoing tool_use messages with the shared `toolSemantic`
// and emits a `mode_transition` event so downstream runtime/UI never branch
// on codex-specific tool vocabulary.

function detectCodexToolSemantic(
  toolName: string,
): 'plan_enter' | 'plan_exit' | 'plan_proposal' | undefined {
  if (toolName === 'EnterPlanMode') return 'plan_enter';
  if (toolName === 'ExitPlanMode') return 'plan_proposal';
  return undefined;
}

function deriveCodexModeTransition(
  toolName: string,
  input: unknown,
  sourceToolUseId: string | undefined,
): { mode: string; reason: 'enter' | 'exit'; plan?: string; sourceToolUseId?: string } | undefined {
  if (toolName === 'EnterPlanMode') {
    return { mode: 'plan', reason: 'enter', sourceToolUseId };
  }
  if (toolName === 'ExitPlanMode') {
    const record = (input && typeof input === 'object') ? (input as Record<string, unknown>) : undefined;
    const plan = typeof record?.plan === 'string' ? (record.plan as string) : undefined;
    return { mode: 'default', reason: 'exit', plan, sourceToolUseId };
  }
  return undefined;
}

// ── ThreadItem → ClaudeMessage mapping ───────────────────────

function fileChangeEffectFromCodexChanges(changes: unknown) {
  return typeof changes === 'string'
    ? fileChangeEffectFromSummaryText(changes)
    : fileChangeEffectFromArray(changes);
}

function mapItemStarted(item: ThreadItem): ClaudeMessage | null {
  const toolUseId = (item as { id?: string }).id;
  switch (item.type) {
    case 'agent_message':
      return { type: 'assistant', content: item.text };
    case 'reasoning':
      return { type: 'assistant', content: `<think>${item.text}</think>` };
    case 'command_execution':
      return {
        type: 'tool_use',
        toolUseId,
        toolName: 'Bash',
        toolInput: { command: item.command },
        toolEffect: makeShellEffect(item.command),
      };
    case 'file_change':
      {
        const changes = (item as { changes?: unknown }).changes;
        return {
          type: 'tool_use',
          toolUseId,
          toolName: 'Edit',
          toolInput: { changes },
          toolEffect: fileChangeEffectFromCodexChanges(changes),
        };
      }
    case 'mcp_tool_call': {
      const toolName = normalizeMcpToolName(item.server, item.tool);
      return {
        type: 'tool_use',
        toolUseId,
        toolName,
        toolInput: item.arguments,
        toolSemantic: detectCodexToolSemantic(toolName),
      };
    }
    case 'web_search':
      return {
        type: 'tool_use',
        toolUseId,
        toolName: 'WebSearch',
        toolInput: { query: item.query },
      };
    case 'todo_list':
      return {
        type: 'tool_use',
        toolUseId,
        toolName: 'TodoWrite',
        toolInput: { items: item.items },
      };
    case 'error':
      return { type: 'error', error: item.message };
    default:
      return null;
  }
}

function mapItemCompleted(item: ThreadItem): ClaudeMessage | null {
  const toolUseId = (item as { id?: string }).id;
  switch (item.type) {
    case 'agent_message':
      // Final text — emit as assistant
      return { type: 'assistant', content: item.text };
    case 'command_execution':
      return {
        type: 'tool_result',
        toolUseId,
        toolName: 'Bash',
        toolResult: item.aggregated_output,
        isToolError: item.status === 'failed',
      };
    case 'file_change':
      {
        const changes = (item as { changes?: unknown }).changes;
        return {
          type: 'tool_result',
          toolUseId,
          toolName: 'Edit',
          toolResult: item.status === 'completed' ? 'Applied' : 'Failed',
          isToolError: item.status === 'failed',
          toolEffect: fileChangeEffectFromCodexChanges(changes),
        };
      }
    case 'mcp_tool_call': {
      const resultText = item.result
        ? JSON.stringify(item.result.content)
        : item.error?.message || 'No result';
      return {
        type: 'tool_result',
        toolUseId,
        toolName: normalizeMcpToolName(item.server, item.tool),
        toolResult: resultText,
        isToolError: item.status === 'failed',
      };
    }
    case 'web_search':
      return {
        type: 'tool_result',
        toolUseId,
        toolName: 'WebSearch',
        toolResult: 'Search completed',
      };
    default:
      return null;
  }
}

// ── Codex instance cache (keyed by cliPath) ──────────────────

const codexInstances = new Map<string, Codex>();

function buildCodexEnv(options: CodexRunOptions): Record<string, string> {
  const mergedEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      mergedEnv[key] = value;
    }
  }

  sanitizeInheritedProviderEnv(mergedEnv);

  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      mergedEnv[key] = value;
    }
  }

  return mergedEnv;
}

function getCodexCacheKey(options: CodexRunOptions, env: Record<string, string>): string {
  const envSignature = JSON.stringify(
    Object.keys(env)
      .sort()
      .map((key) => [key, env[key]])
  );
  return `${options.cliPath || '__default__'}::${envSignature}`;
}

interface CodexConfigValue {
  [key: string]: string | string[] | CodexConfigValue;
}

function buildCodexMcpConfig(options: CodexRunOptions): CodexConfigValue | null {
  const mcpServers: Record<string, CodexConfigValue> = {};

  if (options.db) {
    Object.assign(mcpServers, loadMcpServersFromDb(options.db, 'codex'));
  }

  if (options.serverPort) {
    const bridgeEntry = buildMcpBridgeEntry(options.serverPort, options.claudiaSessionId);
    if (bridgeEntry) {
      mcpServers['claudia-plugins'] = bridgeEntry as unknown as CodexConfigValue;
    }
  }

  if (Object.keys(mcpServers).length === 0) return null;

  return {
    mcp_servers: mcpServers,
  };
}

function getCodexInstance(options: CodexRunOptions): Codex {
  const mergedEnv = buildCodexEnv(options);

  // If MCP is configured, create a non-cached instance per run.
  // This avoids stale DB-backed server lists and preserves session-scoped bridge env.
  const mcpConfig = buildCodexMcpConfig(options);
  if (mcpConfig) {
    console.log(`[Codex SDK] Creating instance with MCP config (session: ${options.claudiaSessionId || 'none'})`);
    return new Codex({
      codexPathOverride: options.cliPath,
      env: mergedEnv,
      config: mcpConfig,
    });
  }

  // Standard cached instance (no MCP bridge)
  const key = getCodexCacheKey(options, mergedEnv);
  let codex = codexInstances.get(key);
  if (!codex) {
    codex = new Codex({
      codexPathOverride: options.cliPath,
      env: mergedEnv,
    });
    codexInstances.set(key, codex);
  }
  return codex;
}

// ── Main run function ────────────────────────────────────────

export async function* runCodex(
  input: string,
  options: CodexRunOptions,
  _onPermission: PermissionCallback,
): AsyncGenerator<ClaudeMessage, void, void> {
  // Clear text tracking state at the start of each run to prevent stale state
  // from previous runs (especially when resuming threads)
  itemEmittedText.clear();
  itemStartedToolUseIds.clear();

  const codex = getCodexInstance(options);
  const policies = mapModeToPolicies(options.mode);

  const threadOptions: ThreadOptions = {
    model: options.model,
    workingDirectory: options.cwd,
    skipGitRepoCheck: true,
    ...policies,
  };

  // Prepare input (handle images)
  let codexInput = prepareCodexInput(input);

  // 🆕 Handle systemPrompt: prepend to input for new sessions only
  // Codex SDK doesn't have native systemPrompt support, so we prepend to the input
  if (options.systemPrompt && !options.sessionId) {
    const systemContext = `[System Context]\n${options.systemPrompt}`;

    if (Array.isArray(codexInput)) {
      // Input is UserInput[] - prepend to first text element
      const firstText = codexInput.find(p => p.type === 'text');
      if (firstText && firstText.type === 'text') {
        firstText.text = `${systemContext}\n\n${firstText.text}`;
      } else {
        // No text element, prepend a new one
        codexInput = [{ type: 'text', text: systemContext }, ...codexInput];
      }
    } else if (typeof codexInput === 'string') {
      // Input is a plain string
      codexInput = `${systemContext}\n\n${codexInput}`;
    }
    console.log(`[Codex SDK] Prepended system prompt (${options.systemPrompt.length} chars)`);
  }

  // Set up abort controller
  const abortController = new AbortController();
  if (options.sessionId) {
    activeAbortControllers.set(options.sessionId, abortController);
  }

  try {
    for (let attempt = 1; attempt <= MAX_AUTO_RETRIES + 1; attempt++) {
      let producedOutput = false;
      let receivedTurnCompleted = false;
      try {
        // Start or resume thread.
        // options.sessionId is the codex thread_id stored by server as sdk_session_id after the first run.
        const thread = options.sessionId
          ? codex.resumeThread(options.sessionId, threadOptions)
          : codex.startThread(threadOptions);

        console.log(`[Codex] ${options.sessionId ? `Resuming thread ${options.sessionId.slice(0, 8)}...` : 'Starting new thread'} (attempt ${attempt})`);

        // Run streamed
        const { events } = await thread.runStreamed(codexInput, {
          signal: abortController.signal,
        });

        for await (const event of events) {
          const messages = mapThreadEvent(event, options.sessionId, {
            cwd: options.cwd,
            apiKeySource: 'codex-sdk',
            model: options.model || '',
            mcpServers: [],
            tools: [],
          });
          for (const msg of messages) {
            // Track if we received turn completion
            if (msg.type === 'result' && msg.isComplete) {
              receivedTurnCompleted = true;
            }
            if (msg.type === 'error') {
              const errText = msg.error || 'Codex error';
              const canRetry =
                attempt <= MAX_AUTO_RETRIES &&
                !producedOutput &&
                isRetryableError(errText);
              if (canRetry) {
                throw new Error(errText);
              }
            } else if (msg.type !== 'init') {
              producedOutput = true;
            }
            yield msg;
          }
        }

        // Stream ended without turn.completed — this is abnormal termination
        if (!receivedTurnCompleted) {
          console.warn(`[Codex] Stream ended without turn.completed. producedOutput=${producedOutput}, attempt=${attempt}`);
          if (!producedOutput && attempt <= MAX_AUTO_RETRIES) {
            // No output yet — safe to retry automatically
            const delayMs = getBackoffDelayMs(attempt, true);
            console.warn(`[Codex] Stream disconnected before any output, retrying in ${delayMs}ms (attempt ${attempt}/${MAX_AUTO_RETRIES + 1})`);
            await sleep(delayMs);
            continue; // retry the for loop
          }
          const errMsg = producedOutput
            ? 'Codex session ended unexpectedly without completion signal'
            : 'Codex session produced no output';
          yield { type: 'error', error: errMsg };
        }
        return;
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          // User-initiated abort — not an error
          return;
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        const streamErr = isRetryableStreamError(errorMsg);
        const canRetry =
          attempt <= MAX_AUTO_RETRIES &&
          !producedOutput &&
          isRetryableError(errorMsg);
        if (!canRetry) {
          yield { type: 'error', error: `Codex error: ${errorMsg}` };
          return;
        }

        const parsedDelayMs = extractRetryDelayMsFromError(errorMsg);
        const delayMs = parsedDelayMs ?? getBackoffDelayMs(attempt, streamErr);
        const errorKind = streamErr ? 'stream' : 'limit';
        console.warn(`[Codex] Retryable ${errorKind} error (attempt ${attempt}/${MAX_AUTO_RETRIES + 1}): ${errorMsg}`);
        console.log(`[Codex] Retrying in ${delayMs}ms${parsedDelayMs != null ? ' (from reset hint)' : ' (backoff fallback)'}...`);
        await sleep(delayMs);
      }
    }
  } catch (err: unknown) {
    if (abortController.signal.aborted) {
      // User-initiated abort or stream ended unexpectedly
      console.log(`[Codex] Stream aborted. signal.aborted=${abortController.signal.aborted}`);
      return;
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    yield { type: 'error', error: `Codex error: ${errorMsg}` };
  } finally {
    if (options.sessionId) {
      activeAbortControllers.delete(options.sessionId);
    }
  }
}

// ── Event mapping ────────────────────────────────────────────

// Track emitted text per item to deduplicate item.completed re-emission.
// Codex CLI may send `item.text` as either accumulated text or incremental delta
// depending on the event type and CLI version.  We detect which mode by checking
// whether the new text starts with what we've already emitted (accumulated) or not
// (incremental delta).
const itemEmittedText = new Map<string, string>();
const itemStartedToolUseIds = new Set<string>();

function getItemId(item: ThreadItem): string {
  return (item as { id?: string }).id || `__anon_${item.type}`;
}

/**
 * Extracts the portion of `text` that hasn't been emitted yet.
 * Auto-detects accumulated vs incremental text:
 *   - If text starts with previously emitted content → accumulated snapshot; return the new suffix
 *   - Otherwise → incremental delta; pass through as-is
 */
function computeTextDelta(itemId: string, text: string): string {
  if (!text) return '';
  const prev = itemEmittedText.get(itemId) || '';

  if (text.startsWith(prev)) {
    // Text begins with what we already emitted — accumulated snapshot
    if (text.length > prev.length) {
      const delta = text.slice(prev.length);
      itemEmittedText.set(itemId, text);
      return delta;
    }
    // Same as before (e.g. item.completed echoing final text) — nothing new
    return '';
  }

  // Text doesn't start with previous — it's an incremental delta; pass through
  itemEmittedText.set(itemId, prev + text);
  return text;
}

function mapThreadEvent(event: ThreadEvent, sessionId?: string, initSystemInfo?: SystemInfo): ClaudeMessage[] {
  const messages: ClaudeMessage[] = [];

  switch (event.type) {
    case 'thread.started': {
      // Emit init message
      const systemInfo: SystemInfo = initSystemInfo || {
        cwd: '',
        apiKeySource: 'codex-sdk',
        model: '',
        mcpServers: [],
        tools: [],
      };
      messages.push({
        type: 'init',
        sessionId: event.thread_id,
        systemInfo,
      });
      break;
    }

    case 'turn.started':
      // No-op, turn has begun
      break;

    case 'item.started': {
      const itemId = getItemId(event.item);
      // Record initial text so subsequent updates can detect accumulated vs delta.
      if (event.item.type === 'agent_message' || event.item.type === 'reasoning') {
        itemEmittedText.set(itemId, event.item.text || '');
      }
      const msg = mapItemStarted(event.item);
      if (msg) {
        if (msg.type === 'tool_use') itemStartedToolUseIds.add(itemId);
        messages.push(msg);
      }
      break;
    }

    case 'item.updated': {
      const itemId = getItemId(event.item);
      // Compute true delta — only the new portion since last emission.
      if (event.item.type === 'agent_message') {
        const delta = computeTextDelta(itemId, event.item.text);
        if (delta) {
          messages.push({ type: 'assistant', content: delta });
        }
      } else if (event.item.type === 'reasoning') {
        const delta = computeTextDelta(itemId, event.item.text);
        if (delta) {
          messages.push({ type: 'assistant', content: `<think>${delta}</think>` });
        }
      }
      break;
    }

    case 'item.completed': {
      const itemId = getItemId(event.item);
      // For text-bearing items, emit only the remaining delta (if any),
      // then clean up tracking state.
      if (event.item.type === 'agent_message') {
        const delta = computeTextDelta(itemId, event.item.text);
        if (delta) {
          messages.push({ type: 'assistant', content: delta });
        }
        itemEmittedText.delete(itemId);
      } else if (event.item.type === 'reasoning') {
        const delta = computeTextDelta(itemId, event.item.text);
        if (delta) {
          messages.push({ type: 'assistant', content: `<think>${delta}</think>` });
        }
        itemEmittedText.delete(itemId);
      } else {
        const shouldBackfillFileChangeStart = event.item.type === 'file_change'
          && !itemStartedToolUseIds.has(itemId)
          && fileChangeEffectFromCodexChanges((event.item as { changes?: unknown }).changes);
        if (shouldBackfillFileChangeStart) {
          const started = mapItemStarted(event.item);
          if (started) {
            if (started.type === 'tool_use') itemStartedToolUseIds.add(itemId);
            messages.push(started);
          }
        }
        const msg = mapItemCompleted(event.item);
        if (msg) messages.push(msg);

        // Surface plan-mode transitions via the shared mode_transition event.
        // Codex's `enter_plan_mode` / `exit_plan_mode` come through as MCP tool
        // calls; the SDK normalizes them locally so the runtime never branches
        // on codex-specific tool names.
        if (event.item.type === 'mcp_tool_call' && event.item.status === 'completed') {
          const toolName = normalizeMcpToolName(event.item.server, event.item.tool);
          const transition = deriveCodexModeTransition(toolName, event.item.arguments, itemId);
          if (transition) {
            messages.push({ type: 'mode_transition', modeTransition: transition });
          }
        }
      }
      break;
    }

    case 'turn.completed': {
      // Clean up all tracking state for this turn
      itemEmittedText.clear();
      itemStartedToolUseIds.clear();
      const usage = event.usage;
      messages.push({
        type: 'result',
        isComplete: true,
        usage: {
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
        },
      });
      break;
    }

    case 'turn.failed':
      itemEmittedText.clear();
      itemStartedToolUseIds.clear();
      messages.push({ type: 'error', error: `Turn failed: ${event.error.message}` });
      break;

    case 'error':
      itemEmittedText.clear();
      itemStartedToolUseIds.clear();
      messages.push({ type: 'error', error: event.message });
      break;
  }

  return messages;
}

// ── Abort ────────────────────────────────────────────────────

const activeAbortControllers = new Map<string, AbortController>();

export async function abortCodexSession(sessionId: string): Promise<void> {
  const controller = activeAbortControllers.get(sessionId);
  if (controller) {
    controller.abort();
    activeAbortControllers.delete(sessionId);
  }
}
