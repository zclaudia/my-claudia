import type { ClaudeMessage, PermissionCallback } from './claude-sdk.js';
import { CodexAppServerClient, type CodexAppServerOptions } from './codex/codex-app-server-client.js';
import {
  buildEnv,
  debugLog,
  mapModeToConfigArgs,
  prepareAppServerInput,
  writeMcpConfig,
} from './codex/codex-config.js';

export type { CodexAppServerOptions } from './codex/codex-app-server-client.js';
export { CodexAppServerClient } from './codex/codex-app-server-client.js';

// ── Client cache ─────────────────────────────────────────────

const appServerClients = new Map<string, CodexAppServerClient>();

export function getCacheKey(options: CodexAppServerOptions, env: Record<string, string>, configSignature = ''): string {
  // env already contains CLAUDIA_SESSION_ID (injected by buildEnv),
  // so envSignature naturally differentiates per-session processes
  const envSignature = JSON.stringify(
    Object.keys(env).sort().map((key) => [key, env[key]])
  );
  return `${options.cliPath || '__default__'}::${configSignature}::${envSignature}`;
}

export function getOrCreateAppServerClient(options: CodexAppServerOptions): CodexAppServerClient {
  const env = buildEnv(options);
  const modeArgs = mapModeToConfigArgs(options.mode);
  const modelArgs = options.model ? ['-c', `model="${options.model}"`] : [];
  const extraArgs = [...modeArgs, ...modelArgs];
  const { configDir, configSignature } = writeMcpConfig(options);
  const key = getCacheKey(options, env, configSignature);
  let client = appServerClients.get(key);
  if (!client) {
    client = new CodexAppServerClient(options.cliPath, env, extraArgs, {
      processCwd: configDir,
      ownerSessionId: options.claudiaSessionId ?? options.sessionId,
    });
    appServerClients.set(key, client);
  } else {
    // If process args changed (currently model/config), kill the old process so
    // ensureRunning() respawns it with the new args.
    client.updateExtraArgs(extraArgs);
  }
  return client;
}

// ── Main run function ────────────────────────────────────────

/** Errors that indicate a corrupted/unrecoverable session (e.g., bad history with invalid image URLs) */
const SESSION_RECOVERY_PATTERNS = [
  /invalid.*image_url/i,
  /invalid.*url/i,
  /systemError/i,
  /session.*corrupt/i,
  /thread.*not.*found/i,
  /invalid.*input/i,
];

function isRecoverableSessionError(error: string): boolean {
  return SESSION_RECOVERY_PATTERNS.some(p => p.test(error));
}

export async function* runCodexAppServer(
  input: string,
  options: CodexAppServerOptions,
  onPermission: PermissionCallback,
): AsyncGenerator<ClaudeMessage, void, void> {
  const client = getOrCreateAppServerClient(options);
  client.currentMode = options.mode;

  // Track session → client for dynamic mode switching (e.g. AI-initiated plan mode)
  if (options.sessionId) {
    sessionClientMap.set(options.sessionId, client);
  }

  // Start or resume thread
  let threadId: string;
  let isResumed = false;
  debugLog(`[Codex AppServer] runCodexAppServer: sessionId=${options.sessionId || 'NEW'}, cwd=${options.cwd}`);
  if (options.sessionId) {
    try {
      debugLog(`[Codex AppServer] Resuming thread: ${options.sessionId}`);
      await client.resumeThread(options.sessionId);
      threadId = options.sessionId;
      isResumed = true;
    } catch (err) {
      debugLog(`[Codex AppServer] WARN: Resume failed, starting fresh: ${err}`);
      threadId = await client.startThread(options.cwd);
    }
  } else {
    threadId = await client.startThread(options.cwd);
  }
  debugLog(`[Codex AppServer] Using threadId: ${threadId}`);

  // Prepare input
  let inputBlocks = prepareAppServerInput(input);

  // Prepend system prompt for new sessions
  if (options.systemPrompt && !options.sessionId) {
    const systemContext = `[System Context]\n${options.systemPrompt}`;
    const firstText = inputBlocks.find(b => b.type === 'text');
    if (firstText && firstText.text) {
      firstText.text = `${systemContext}\n\n${firstText.text}`;
    } else {
      inputBlocks = [{ type: 'text', text: systemContext }, ...inputBlocks];
    }
  }

  // Run the turn. For resumed sessions, buffer only the initial few messages
  // to detect recoverable session errors (e.g., corrupted history with invalid
  // image URLs). Once the first assistant/tool message arrives without error,
  // flush the buffer and switch to streaming mode.
  let encounteredError: string | null = null;
  const buffered: ClaudeMessage[] = [];
  let streamingMode = !isResumed; // New sessions stream immediately

  for await (const msg of client.runTurn(threadId, inputBlocks, onPermission, {
    model: options.model,
    systemPrompt: options.systemPrompt,
  })) {
    if (msg.type === 'error' && !streamingMode && isRecoverableSessionError(msg.error || '')) {
      encounteredError = msg.error || 'Unknown session error';
      break;
    }

    if (streamingMode) {
      yield msg;
      if (msg.type === 'result' && (msg as { isComplete?: boolean }).isComplete) {
        return;
      }
    } else {
      // Buffering phase: accumulate until we see a non-init, non-error message
      buffered.push(msg);
      const isContentMsg = msg.type === 'assistant' || msg.type === 'tool_use' || msg.type === 'tool_result' || msg.type === 'tool_activity';
      if (isContentMsg || (msg.type === 'result' && (msg as { isComplete?: boolean }).isComplete)) {
        // Session is healthy — flush buffer and switch to streaming
        streamingMode = true;
        for (const m of buffered) yield m;
        buffered.length = 0;
        if (msg.type === 'result' && (msg as { isComplete?: boolean }).isComplete) {
          return;
        }
      }
    }
  }

  // If buffered messages remain (turn ended during buffer phase), flush them
  if (!encounteredError && buffered.length > 0) {
    for (const m of buffered) yield m;
  }

  // If we broke out due to a recoverable error on a resumed session, retry once with a new thread
  if (encounteredError && isResumed) {
    console.warn(`[Codex AppServer] Recovered from broken session ${threadId}: ${encounteredError}. Starting fresh thread.`);
    yield { type: 'assistant', content: `[Session recovery: previous thread failed (${encounteredError}), starting fresh]` } as ClaudeMessage;

    const freshThreadId = await client.startThread(options.cwd);
    debugLog(`[Codex AppServer] Recovery: new threadId=${freshThreadId}`);

    // Re-prepare input (inputBlocks may have been mutated by systemPrompt prepend)
    inputBlocks = prepareAppServerInput(input);

    yield* client.runTurn(freshThreadId, inputBlocks, onPermission, {
      model: options.model,
      systemPrompt: options.systemPrompt,
    });
  }
}

// ── Abort ────────────────────────────────────────────────────

const activeThreadIds = new Map<string, { client: CodexAppServerClient; threadId: string }>();
const sessionClientMap = new Map<string, CodexAppServerClient>();

function deleteSessionClientRefs(client: CodexAppServerClient): void {
  for (const [sessionId, mappedClient] of sessionClientMap) {
    if (mappedClient === client) {
      sessionClientMap.delete(sessionId);
    }
  }
}

export async function abortCodexAppServer(sessionId: string): Promise<void> {
  const entry = activeThreadIds.get(sessionId);
  if (entry) {
    await entry.client.interruptTurn(entry.threadId);
    activeThreadIds.delete(sessionId);
  }
  sessionClientMap.delete(sessionId);
}

/** Dynamically switch a session's mode (e.g. when AI calls EnterPlanMode/ExitPlanMode). */
export function setAppServerClientMode(sessionId: string, mode: string): void {
  const client = sessionClientMap.get(sessionId);
  if (client) {
    client.currentMode = mode;
    debugLog(`[Codex AppServer] Dynamic mode change for session ${sessionId}: ${mode}`);
  }
}

// ── Idle cleanup ─────────────────────────────────────────────

export const IDLE_TIMEOUT_MS = 30 * 60 * 1000;    // 30 minutes
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // scan every 5 minutes

/** Destroy all app-server processes (called on server shutdown) */
export function runIdleCleanup(now = Date.now()): void {
  for (const [key, client] of appServerClients) {
    if (client.activeTurns > 0) continue;
    if (now - client.lastActivity > IDLE_TIMEOUT_MS) {
      debugLog(`[Codex AppServer] Idle cleanup: ${key}`);
      client.destroy();
      appServerClients.delete(key);
      deleteSessionClientRefs(client);
    }
  }
}

const cleanupTimer = setInterval(() => {
  runIdleCleanup();
}, CLEANUP_INTERVAL_MS);
cleanupTimer.unref(); // don't prevent Node.js from exiting

export function destroyAllAppServerClients(): void {
  for (const [key, client] of appServerClients) {
    debugLog(`[Codex AppServer] Shutdown cleanup: ${key}`);
    client.destroy();
  }
  appServerClients.clear();
  sessionClientMap.clear();
  clearInterval(cleanupTimer);
}

export function resetAppServerClientsForTests(): void {
  appServerClients.clear();
  sessionClientMap.clear();
}
