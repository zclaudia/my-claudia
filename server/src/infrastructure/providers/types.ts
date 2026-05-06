import type { PermissionRequest } from '@my-claudia/shared/interaction/permissions';
import type { PCPProviderManifest } from '@my-claudia/shared/core/pcp';
import type Database from 'better-sqlite3';

// Re-export core provider message types (shared across all providers)
export type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './message-types.js';

/** Options for starting a provider run */
export interface RunOptions {
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  env?: Record<string, string>;
  mode?: string;          // permission mode (claude) or agent (opencode)
  model?: string;
  systemPrompt?: string;  // Appended to system prompt (e.g. for agent sessions)
  sessionTitle?: string;  // Optional session title for providers that support it
  serverPort?: number;    // Main server port for MCP bridge
  claudiaSessionId?: string;  // My-Claudia session ID (for interaction tool context)
  db?: Database.Database;  // Database for loading Claudia-managed MCP servers
}

/** Provider adapter interface */
export interface ProviderAdapter {
  readonly type: string;

  /** PCP manifest — static capability declaration */
  readonly manifest?: PCPProviderManifest;

  /** Start a run, returns async generator of messages */
  run(
    input: string,
    options: RunOptions,
    onPermission: (request: PermissionRequest) => Promise<import('./claude-sdk.js').PermissionDecision>,
  ): AsyncGenerator<import('./claude-sdk.js').ClaudeMessage, void, void>;

  /** Abort an active session */
  abort?(sessionId: string, cwd: string): Promise<void>;

  /** Stop a specific background task. Returns true if processes were actually killed. */
  stopTask?(sessionId: string, taskId: string): Promise<boolean | void>;

  /** Get CLI subprocess PID for a session (if available) */
  getCliPid?(sessionId: string): number | undefined;

  /** Get resolved process info for a specific background task */
  getTaskProcessInfo?(taskId: string): { taskId: string; command?: string; rootPid?: number; pids: number[] } | undefined;

  /** Get provider-specific state to store on ActiveRun */
  getRunState?(options: RunOptions): Record<string, unknown>;

  /** Dynamically switch the session's mode (e.g. when AI calls EnterPlanMode/ExitPlanMode) */
  setSessionMode?(sessionId: string, mode: string): void;
}
