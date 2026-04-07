/**
 * Core provider message types — shared across ALL providers.
 *
 * Extracted from claude-sdk.ts to break the dependency of the Port interface
 * (types.ts) on a concrete Adapter implementation (claude-sdk.ts).
 */

import type { PermissionRequest } from '@my-claudia/shared/interaction/permissions';

export interface PermissionDecision {
  behavior: 'allow' | 'deny';
  updatedInput?: unknown;
  message?: string;
}

export type PermissionCallback = (
  request: PermissionRequest
) => Promise<PermissionDecision>;

export interface SystemInfo {
  model?: string;
  claudeCodeVersion?: string;
  cwd?: string;
  tools?: string[];
  mcpServers?: { name: string; status: string }[];
  permissionMode?: string;
  apiKeySource?: string;
  slashCommands?: string[];
  agents?: string[];
}

export interface ClaudeMessage {
  type: 'init' | 'assistant' | 'result' | 'tool_use' | 'tool_result' | 'error' | 'task_notification' | 'tool_activity';
  sessionId?: string;
  content?: string;
  systemInfo?: SystemInfo;
  toolUseId?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
  isToolError?: boolean;
  error?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    contextWindow?: number;
  };
  isComplete?: boolean;
  taskId?: string;
  taskStatus?: string;
  taskMessage?: string;
  taskToolUseId?: string;
}
