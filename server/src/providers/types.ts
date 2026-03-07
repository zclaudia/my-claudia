import type { PermissionRequest } from '@my-claudia/shared';

// Re-export types from claude-sdk that are shared across providers
export type { ClaudeMessage, SystemInfo, PermissionDecision, PermissionCallback } from './claude-sdk.js';

/** Options for starting a provider run */
export interface RunOptions {
  cwd: string;
  sessionId?: string;
  cliPath?: string;
  env?: Record<string, string>;
  mode?: string;          // permission mode (claude) or agent (opencode)
  model?: string;
  systemPrompt?: string;  // Appended to system prompt (e.g. for agent sessions)
  serverPort?: number;    // Main server port for MCP bridge
}

/** Provider adapter interface */
export interface ProviderAdapter {
  readonly type: string;

  /** Start a run, returns async generator of messages */
  run(
    input: string,
    options: RunOptions,
    onPermission: (request: PermissionRequest) => Promise<import('./claude-sdk.js').PermissionDecision>,
  ): AsyncGenerator<import('./claude-sdk.js').ClaudeMessage, void, void>;

  /** Abort an active session */
  abort?(sessionId: string, cwd: string): Promise<void>;

  /** Get provider-specific state to store on ActiveRun */
  getRunState?(options: RunOptions): Record<string, unknown>;
}
