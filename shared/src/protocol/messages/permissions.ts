/**
 * Permission and prompt-routing messages: permission decisions, prompt answers,
 * permission requests, agent interceptions, resolution notifications, and plugin permissions.
 */

import type { AskUserQuestionItem } from '../../interaction/forms.js';
import type { AIReviewMetadata } from '../../interaction/permissions.js';

// Client → Server

export interface PermissionDecisionMessage {
  type: 'permission_decision';
  requestId: string;
  allow: boolean;
  remember?: boolean;
  /** Optional user feedback attached to a deny decision (e.g., deny ExitPlanMode with guidance). */
  feedback?: string;
  /** RSA-OAEP encrypted credential (base64). Used for sudo password etc. */
  encryptedCredential?: string;
}

// Prompt answer routed back to the originating backend (Client → Server)
export interface PromptAnswerMessage {
  type: 'prompt_answer';
  requestId: string;
  formattedAnswer: string;  // Pre-formatted readable text for Claude
}

// Plugin permission response (Client → Server)
export interface PluginPermissionResponseMessage {
  type: 'plugin_permission_response';
  pluginId: string;
  granted: boolean;
  permanently?: boolean;
}

// Server → Client

export interface PermissionRequestMessage {
  type: 'permission_request';
  requestId: string;
  sessionId: string;
  toolName: string;
  detail: string;
  matchedRule?: string;
  timeoutSeconds: number;
  /** When true, the UI should show a password input for credential (e.g. sudo). */
  requiresCredential?: boolean;
  /** Hint for what kind of credential is needed (e.g. 'sudo_password'). */
  credentialHint?: string;
  /** When true, timeout will auto-approve (not deny); show countdown accordingly. */
  aiInitiated?: boolean;
  /** When true, this permission is being handled by a permission workflow. */
  workflowMode?: boolean;
  /** Workflow run ID for tracking progress. */
  workflowRunId?: string;
}

// Prompt request: transport-level native question routing (Server → Client)
export interface PromptRequestMessage {
  type: 'prompt_request';
  requestId: string;
  sessionId: string;
  questions: AskUserQuestionItem[];
}

// Agent permission auto-approval notification (Server → Client)
export interface AgentPermissionInterceptedMessage {
  type: 'agent_permission_intercepted';
  toolName: string;
  decision: 'approve' | 'deny';
  reason: string;
  sessionId: string;     // The session whose permission was intercepted
  runId: string;
}

// Server → Client: a permission request has been resolved by another device
export interface PermissionResolvedMessage {
  type: 'permission_resolved';
  requestId: string;
  sessionId?: string;
  decision: 'allow' | 'deny';
}

// Server → Client: a permission request was auto-resolved by backend timer
export interface PermissionAutoResolvedMessage {
  type: 'permission_auto_resolved';
  requestId: string;
  sessionId: string;
  /** Whether the backend approved or denied on timeout expiry. */
  behavior: 'approve' | 'deny';
  /** Optional reason for the auto-resolution (e.g., AI review reasoning). */
  reason?: string;
  metadata?: AIReviewMetadata;
}

// Server → Client: AI review completed for an escalated permission request
export interface AIReviewCompletedMessage {
  type: 'ai_review_completed';
  requestId: string;
  sessionId: string;
  decision: 'approve' | 'deny' | 'uncertain';
  reasoning: string;
  confidence: number;
  metadata?: AIReviewMetadata;
}

// Server → Client: a prompt_request has been resolved by another device
export interface PromptRequestResolvedMessage {
  type: 'prompt_request_resolved';
  requestId: string;
  sessionId?: string;
}

// Server → Client: permission workflow step progress
export interface PermissionWorkflowProgressMessage {
  type: 'permission_workflow_progress';
  requestId: string;
  sessionId: string;
  workflowRunId: string;
  currentStep: {
    id: string;
    type: string;
    status: 'running' | 'completed' | 'failed';
    label: string;
  };
  completedSteps: string[];
  totalSteps: number;
}

// Plugin permission request (Server → Client)
export interface PluginPermissionRequestMessage {
  type: 'plugin_permission_request';
  pluginId: string;
  pluginName: string;
  permissions: string[];
}
