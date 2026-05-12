/**
 * Core provider message types — shared across ALL providers.
 *
 * Extracted from claude-sdk.ts to break the dependency of the Port interface
 * (types.ts) on a concrete Adapter implementation (claude-sdk.ts).
 */

import type { PermissionRequest } from '@my-claudia/shared/interaction/permissions';
import type { ToolEffect } from '@my-claudia/shared/core/message';
import type { ToolSemantic } from '@my-claudia/shared/protocol/messages/run';

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
  type:
    | 'init'
    | 'assistant'
    | 'result'
    | 'tool_use'
    | 'tool_result'
    | 'error'
    | 'task_notification'
    | 'tool_activity'
    | 'mode_transition';
  sessionId?: string;
  content?: string;
  systemInfo?: SystemInfo;
  toolUseId?: string;
  toolName?: string;
  toolInput?: unknown;
  /**
   * Provider-normalized side effect. Provider SDKs/adapters translate their
   * native tool vocabulary into this shape so common layers stay provider-agnostic.
   */
  toolEffect?: ToolEffect;
  /**
   * Provider-supplied semantic tag for the tool. The provider SDK is the only
   * place that knows whether one of its native tools carries a plan proposal
   * or controls plan-mode; it tags those events here so the runtime and UI
   * can react without string-matching tool names.
   */
  toolSemantic?: ToolSemantic;
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

  /**
   * Provider-emitted semantic event. The provider SDK is the only place that
   * knows the names of its own plan / mode-switching tools; it normalizes them
   * into this event so the runtime stays provider-agnostic.
   */
  modeTransition?: {
    /** Canonical target mode (e.g. 'plan', 'default'). */
    mode: string;
    /** 'enter' = entering plan mode, 'exit' = leaving plan mode. */
    reason: 'enter' | 'exit';
    /** Optional plan markdown to surface to the user (typically with reason='exit'). */
    plan?: string;
    /** Tool use id of the tool call that triggered this transition. */
    sourceToolUseId?: string;
  };
}
