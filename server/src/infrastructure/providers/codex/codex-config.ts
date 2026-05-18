import { appendFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readFileSync, realpathSync } from 'fs';
import { join, extname } from 'path';
import { homedir } from 'os';
import { fileStore } from '../../storage/fileStore.js';
import { parseMessageInput, prependNonImageNotes } from '../provider-input.js';
import { sanitizeInheritedProviderEnv } from '../../../utils/startup-env.js';
import { buildMcpBridgeEntry } from '../../../utils/mcp-bridge-launch.js';
import { loadMcpServersFromDb } from '../../../utils/mcp-config.js';
import type { CodexAppServerOptions } from './codex-app-server-client.js';

// File-based debug log (stdout is captured by Tauri)
export const DEBUG_LOG = '/tmp/codex-app-server-debug.log';
export function debugLog(msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}\n`;
  try { appendFileSync(DEBUG_LOG, line); } catch { /* ignore */ }
  console.log(msg);
}

// ── claudia-plugins MCP tool name normalization ─────────────
// Plan mode tools are registered as MCP tools (snake_case) but run-handler
// expects PascalCase names matching Claude SDK's native tools.
export const CLAUDIA_TOOL_NAME_MAP: Record<string, string> = {
  'enter_plan_mode': 'EnterPlanMode',
  'exit_plan_mode': 'ExitPlanMode',
};

export function normalizeClaudiaToolName(namespace: string | undefined, name: string): string {
  if (namespace === 'claudia-plugins') {
    const mapped = CLAUDIA_TOOL_NAME_MAP[name];
    if (mapped) return mapped;
  }
  return namespace ? `mcp:${namespace}:${name}` : name || 'Unknown';
}

// ── Codex AppServer plan-mode semantics ──────────────────────
//
// Plan-mode is routed through the claudia-plugins MCP bridge above, but the
// downstream runtime and UI should not know that. The codex AppServer SDK
// tags its outgoing tool_use messages with the shared `toolSemantic` and
// emits a `mode_transition` event for the runtime to consume.

export function detectCodexAppServerToolSemantic(
  toolName: string,
): 'plan_enter' | 'plan_exit' | 'plan_proposal' | undefined {
  if (toolName === 'EnterPlanMode') return 'plan_enter';
  if (toolName === 'ExitPlanMode') return 'plan_proposal';
  return undefined;
}

export function deriveCodexAppServerModeTransition(
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

// ── Mode → sandbox/approval config args ──────────────────────
//
// NOTE: `sandbox_permissions` via `-c` has no effect in app-server mode
// (sandbox is always workspaceWrite). Keep approval requests enabled for every
// mode and make the decision in handleServerRequest so dynamic mode switches
// (for example EnterPlanMode during a bypass run) take effect immediately.

export function mapModeToConfigArgs(mode?: string): string[] {
  const args: string[] = [];
  switch (mode) {
    case 'plan':
      // Keep on-request; our approval handler will decline all writes
      args.push('-c', 'approval_policy="on-request"');
      break;
    case 'bypassPermissions':
      // Keep requests enabled; our handler auto-approves while this mode is active.
      args.push('-c', 'approval_policy="on-request"');
      break;
    case 'acceptEdits':
    case 'default':
    default:
      // Standard mode: approval requests forwarded to user
      args.push('-c', 'approval_policy="on-request"');
      break;
  }
  return args;
}

// ── Input preparation ────────────────────────────────────────

export interface AppServerInputBlock {
  type: 'text' | 'image';
  text?: string;
  url?: string;
}

export function prepareAppServerInput(rawInput: string): AppServerInputBlock[] {
  const parsed = parseMessageInput(rawInput);
  if (!parsed) return [{ type: 'text', text: rawInput }];

  let text = prependNonImageNotes(parsed.text, parsed.attachments);
  const blocks: AppServerInputBlock[] = [];

  for (const attachment of parsed.attachments) {
    if (attachment.type === 'image') {
      const filePath = fileStore.getFilePath(attachment.fileId);
      if (filePath) {
        try {
          const base64Data = readFileSync(filePath, { encoding: 'base64' });
          const ext = extname(filePath).toLowerCase().replace('.', '');
          const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
            : ext === 'png' ? 'image/png'
            : ext === 'gif' ? 'image/gif'
            : ext === 'webp' ? 'image/webp'
            : 'image/png';
          blocks.push({ type: 'image', url: `data:${mimeType};base64,${base64Data}` });
          debugLog(`[Codex AppServer] Attached image: ${attachment.name} → base64 (${base64Data.length} chars)`);
        } catch (err) {
          debugLog(`[Codex AppServer] WARN: Could not read image ${filePath}: ${err}`);
        }
      }
    }
  }

  blocks.unshift({ type: 'text', text });
  return blocks;
}

// ── MCP config via stable app data cwd ───────────────────────
// The `-c` flag with JSON values hangs app-server, overriding CODEX_HOME
// breaks multi-login, and writing to the project dir pollutes repos.
//
// Solution: use a stable directory under our app data dir as the
// app-server process cwd, with `.codex/config.toml` containing MCP
// servers.  Codex loads project-level config from cwd, while auth +
// user settings still come from the global CODEX_HOME.  The real
// project cwd is passed via `thread/start { cwd }` separately.
//
// Benefits:
// - All codex sessions share one process + one config dir
// - MCP changes are picked up on next run (or via config/mcpServer/reload)
// - Session rollout files persist → thread/resume works after restart
// - CODEX_HOME is untouched → multi-login works
// - No temp dir cleanup needed

export function getCodexConfigDir(): string {
  const dataDir = process.env.MY_CLAUDIA_DATA_DIR
    ? join(process.env.MY_CLAUDIA_DATA_DIR)
    : join(homedir(), '.my-claudia');
  return join(dataDir, 'codex-config');
}

export function mcpServersToToml(mcpServers: Record<string, unknown>): string {
  return Object.entries(mcpServers).sort(([a], [b]) => a.localeCompare(b)).map(([name, config]) => {
    const cfg = config as Record<string, unknown>;
    const lines: string[] = [`[mcp_servers.${name}]`];
    if (cfg.command) lines.push(`command = ${JSON.stringify(cfg.command)}`);
    if (cfg.args && Array.isArray(cfg.args)) {
      lines.push(`args = ${JSON.stringify(cfg.args)}`);
    }
    if (cfg.env && typeof cfg.env === 'object') {
      lines.push(`[mcp_servers.${name}.env]`);
      for (const [k, v] of Object.entries(cfg.env as Record<string, string>).sort(([a], [b]) => a.localeCompare(b))) {
        lines.push(`${k} = ${JSON.stringify(v)}`);
      }
    }
    if (cfg.url) lines.push(`url = ${JSON.stringify(cfg.url)}`);
    return lines.join('\n');
  }).join('\n\n');
}

export function buildMcpConfigToml(options: CodexAppServerOptions): string {
  const mcpServers: Record<string, unknown> = {};
  if (options.db) {
    Object.assign(mcpServers, loadMcpServersFromDb(options.db, 'codex'));
  }
  if (options.serverPort) {
    // No sessionId in bridge config — bridge inherits CLAUDIA_SESSION_ID
    // from the per-session app-server parent process env
    const bridgeEntry = buildMcpBridgeEntry(options.serverPort);
    if (bridgeEntry) {
      mcpServers['claudia-plugins'] = bridgeEntry;
    }
  }

  return Object.keys(mcpServers).length > 0 ? mcpServersToToml(mcpServers) : '';
}

export function upsertTrustedProjectConfig(existing: string, projectPath: string): string {
  const header = `[projects.${JSON.stringify(projectPath)}]`;
  const sectionPattern = new RegExp(`(^|\\n)${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\n(?:[^\\[][^\\n]*\\n?)*)?`, 'm');

  if (!sectionPattern.test(existing)) {
    const trimmed = existing.trimEnd();
    return `${trimmed ? `${trimmed}\n\n` : ''}${header}\ntrust_level = "trusted"\n`;
  }

  return existing.replace(sectionPattern, (match) => {
    if (/^\s*trust_level\s*=.*$/m.test(match)) {
      return match.replace(/^\s*trust_level\s*=.*$/m, 'trust_level = "trusted"');
    }
    return `${match.trimEnd()}\ntrust_level = "trusted"\n`;
  });
}

export function ensureCodexProjectTrusted(configDir: string): void {
  const userCodexConfigPath = join(homedir(), '.codex', 'config.toml');
  const trustPaths = new Set<string>([configDir]);

  try {
    trustPaths.add(realpathSync(configDir));
  } catch {
    // Best effort only; fall back to the original path.
  }

  let existing = '';
  if (existsSync(userCodexConfigPath)) {
    try {
      existing = readFileSync(userCodexConfigPath, 'utf-8');
    } catch (error) {
      debugLog(`[Codex AppServer] WARN: Failed to read user Codex config: ${error}`);
      return;
    }
  } else {
    mkdirSync(join(homedir(), '.codex'), { recursive: true });
  }

  let next = existing;
  for (const trustPath of trustPaths) {
    next = upsertTrustedProjectConfig(next, trustPath);
  }

  if (next !== existing) {
    try {
      writeFileSync(userCodexConfigPath, next, 'utf-8');
      debugLog(`[Codex AppServer] Trusted project for config loading: ${Array.from(trustPaths).join(', ')}`);
    } catch (error) {
      debugLog(`[Codex AppServer] WARN: Failed to update user Codex trust config: ${error}`);
    }
  }
}

/**
 * Write MCP config to the stable codex config dir.
 * Session ID is passed via parent process env (CLAUDIA_SESSION_ID),
 * not via config — bridge child processes inherit it automatically.
 */
/** Last written config content — skip redundant writes */
let lastWrittenConfig = '';

export function writeMcpConfig(options: CodexAppServerOptions): { configDir: string; configSignature: string } {
  const configDir = getCodexConfigDir();
  mkdirSync(configDir, { recursive: true });
  ensureCodexProjectTrusted(configDir);
  const configToml = buildMcpConfigToml(options);

  // Only write when config content actually changed
  if (configToml !== lastWrittenConfig) {
    const codexDir = join(configDir, '.codex');
    mkdirSync(codexDir, { recursive: true });
    const configPath = join(codexDir, 'config.toml');

    if (configToml) {
      writeFileSync(configPath, configToml, 'utf-8');
      debugLog(`[Codex AppServer] Wrote MCP config: ${configPath}`);
    } else if (existsSync(configPath)) {
      unlinkSync(configPath);
      debugLog(`[Codex AppServer] Removed MCP config: ${configPath}`);
    }
    lastWrittenConfig = configToml;
  }

  return { configDir, configSignature: configToml };
}

export function buildEnv(options: CodexAppServerOptions): Record<string, string> {
  const mergedEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) mergedEnv[key] = value;
  }
  sanitizeInheritedProviderEnv(mergedEnv);
  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      mergedEnv[key] = value;
    }
  }
  // Per-session process: inject session ID into env so MCP bridge
  // child processes inherit it automatically
  if (options.claudiaSessionId) {
    mergedEnv.CLAUDIA_SESSION_ID = options.claudiaSessionId;
  }
  return mergedEnv;
}
