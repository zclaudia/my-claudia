import { readFileSync } from 'fs';
import {
  Codex,
  type ThreadOptions,
  type ThreadEvent,
  type ThreadItem,
  type Input,
  type UserInput,
  type Usage as CodexUsage,
} from '@openai/codex-sdk';
import type { MessageInput, PermissionRequest } from '@my-claudia/shared';
import type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './claude-sdk.js';
import { fileStore } from '../storage/fileStore.js';
import { extractRetryDelayMsFromError } from '../utils/retry-window.js';
import { buildNonImageAttachmentNotes } from './attachment-utils.js';
import { fetchCodexSubscriptionInfo } from './subscription-usage.js';

// ── Types ─────────────────────────────────────────────────────

export interface CodexRunOptions {
  cwd: string;
  sessionId?: string;       // Our session ID (maps to sdk_session_id = thread_id)
  cliPath?: string;         // codexPathOverride
  env?: Record<string, string>;
  model?: string;
  mode?: string;            // Our permission mode → approval + sandbox
  systemPrompt?: string;
}

const MAX_AUTO_RETRIES = 2;

function isRetryableLimitError(errorMessage: string): boolean {
  const msg = errorMessage.toLowerCase();
  return (
    msg.includes('rate limit') ||
    msg.includes('ratelimit') ||
    msg.includes('too many requests') ||
    msg.includes('429') ||
    msg.includes('insufficient_quota') ||
    msg.includes('quota') ||
    msg.includes('usage limit') ||
    msg.includes('billing')
  );
}

function getBackoffDelayMs(attempt: number): number {
  return 2000 * Math.pow(2, Math.max(0, attempt - 1)); // 2s, 4s
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Mode → Codex policy mapping ──────────────────────────────

function mapModeToPolicies(mode?: string): Pick<ThreadOptions, 'approvalPolicy' | 'sandboxMode'> {
  switch (mode) {
    case 'plan':
      return { approvalPolicy: 'on-request', sandboxMode: 'read-only' };
    case 'bypassPermissions':
      return { approvalPolicy: 'never', sandboxMode: 'danger-full-access' };
    case 'acceptEdits':
      return { approvalPolicy: 'on-failure', sandboxMode: 'workspace-write' };
    case 'default':
    default:
      return { approvalPolicy: 'on-request', sandboxMode: 'workspace-write' };
  }
}

// ── Input preparation (handle images) ────────────────────────

function prepareCodexInput(input: string): Input {
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
  if (!messageInput.attachments || messageInput.attachments.length === 0) {
    return text;
  }
  const nonImageNotes = buildNonImageAttachmentNotes(messageInput.attachments);
  if (nonImageNotes.length > 0) {
    text = `${nonImageNotes.join('\n\n')}\n\n${text}`;
  }

  // Build UserInput array with text + images
  const parts: UserInput[] = [{ type: 'text', text }];

  for (const attachment of messageInput.attachments) {
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

// ── ThreadItem → ClaudeMessage mapping ───────────────────────

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
      };
    case 'file_change':
      return {
        type: 'tool_use',
        toolUseId,
        toolName: 'Edit',
        toolInput: { changes: item.changes },
      };
    case 'mcp_tool_call':
      return {
        type: 'tool_use',
        toolUseId,
        toolName: `mcp:${item.server}:${item.tool}`,
        toolInput: item.arguments,
      };
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
      return {
        type: 'tool_result',
        toolUseId,
        toolName: 'Edit',
        toolResult: item.status === 'completed' ? 'Applied' : 'Failed',
        isToolError: item.status === 'failed',
      };
    case 'mcp_tool_call': {
      const resultText = item.result
        ? JSON.stringify(item.result.content)
        : item.error?.message || 'No result';
      return {
        type: 'tool_result',
        toolUseId,
        toolName: `mcp:${item.server}:${item.tool}`,
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

function getCodexInstance(options: CodexRunOptions): Codex {
  const key = options.cliPath || '__default__';
  let codex = codexInstances.get(key);
  if (!codex) {
    // Codex SDK: if env is provided, it does NOT inherit process.env
    // We must merge them manually to ensure system env vars (PATH, etc.) are available
    let mergedEnv: Record<string, string> | undefined;
    if (options.env) {
      // Convert process.env to Record<string, string>, filtering out undefined values
      const processEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) {
          processEnv[key] = value;
        }
      }
      mergedEnv = { ...processEnv, ...options.env };
    }

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
  const subscriptionInfo = await fetchCodexSubscriptionInfo(options.env).catch((error) => ({
    provider: 'codex',
    status: 'error' as const,
    summary: `Failed to fetch subscription usage: ${error instanceof Error ? error.message : String(error)}`,
    updatedAt: Date.now(),
  }));
  const codex = getCodexInstance(options);
  const policies = mapModeToPolicies(options.mode);

  const threadOptions: ThreadOptions = {
    model: options.model,
    workingDirectory: options.cwd,
    skipGitRepoCheck: true,
    ...policies,
  };

  // Prepare input (handle images)
  const codexInput = prepareCodexInput(input);

  // Set up abort controller
  const abortController = new AbortController();
  if (options.sessionId) {
    activeAbortControllers.set(options.sessionId, abortController);
  }

  try {
    for (let attempt = 1; attempt <= MAX_AUTO_RETRIES + 1; attempt++) {
      let producedOutput = false;
      try {
        // Start or resume thread.
        // options.sessionId is the codex thread_id stored by server as sdk_session_id after the first run.
        const thread = options.sessionId
          ? codex.resumeThread(options.sessionId, threadOptions)
          : codex.startThread(threadOptions);

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
            subscription: subscriptionInfo,
          });
          for (const msg of messages) {
            if (msg.type === 'error') {
              const errText = msg.error || 'Codex error';
              const canRetry =
                attempt <= MAX_AUTO_RETRIES &&
                !producedOutput &&
                isRetryableLimitError(errText);
              if (canRetry) {
                throw new Error(errText);
              }
            } else if (msg.type !== 'init') {
              producedOutput = true;
            }
            yield msg;
          }
        }
        return;
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          // User-initiated abort — not an error
          return;
        }
        const errorMsg = err instanceof Error ? err.message : String(err);
        const canRetry =
          attempt <= MAX_AUTO_RETRIES &&
          !producedOutput &&
          isRetryableLimitError(errorMsg);
        if (!canRetry) {
          yield { type: 'error', error: `Codex error: ${errorMsg}` };
          return;
        }

        const parsedDelayMs = extractRetryDelayMsFromError(errorMsg);
        const delayMs = parsedDelayMs ?? getBackoffDelayMs(attempt);
        console.warn(`[Codex] Retryable limit error (attempt ${attempt}/${MAX_AUTO_RETRIES + 1}): ${errorMsg}`);
        console.log(`[Codex] Retrying in ${delayMs}ms${parsedDelayMs != null ? ' (from reset hint)' : ' (backoff fallback)'}...`);
        await sleep(delayMs);
      }
    }
  } catch (err: unknown) {
    if (abortController.signal.aborted) {
      // User-initiated abort — not an error
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
      const msg = mapItemStarted(event.item);
      if (msg) messages.push(msg);
      break;
    }

    case 'item.updated': {
      // For streaming updates (agent_message text deltas)
      if (event.item.type === 'agent_message') {
        messages.push({ type: 'assistant', content: event.item.text });
      } else if (event.item.type === 'reasoning') {
        messages.push({ type: 'assistant', content: `<think>${event.item.text}</think>` });
      }
      break;
    }

    case 'item.completed': {
      const msg = mapItemCompleted(event.item);
      if (msg) messages.push(msg);
      break;
    }

    case 'turn.completed': {
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
      messages.push({ type: 'error', error: `Turn failed: ${event.error.message}` });
      break;

    case 'error':
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
