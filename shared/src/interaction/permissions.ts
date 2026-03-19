// Permission Types

import type { SessionType } from '../core/session.js';

export type PermissionDecision = 'allow' | 'deny' | 'timeout';

export interface PermissionLog {
  id: string;
  sessionId: string;
  tool: string;
  detail: string;
  decision: PermissionDecision;
  remembered: boolean;
  createdAt: number;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: unknown;
  detail: string;
  timeoutSeconds: number;
  /** What to do when the timeout expires. Defaults to 'deny'. */
  timeoutBehavior?: 'approve' | 'deny';
}

// Agent Permission Policy Types

export interface AgentPermissionPolicy {
  enabled: boolean;
  trustLevel: 'conservative' | 'moderate' | 'aggressive' | 'full_trust';

  customRules: AgentPermissionRule[];
  escalateAlways: string[];     // tool names that always go to user

  /** @deprecated Strategies are now built into trust levels. Kept for backward compat parsing. */
  strategies?: unknown;
}

export interface AgentPermissionRule {
  toolName: string;      // exact match or '*'
  pattern?: string;      // optional regex on detail
  action: 'approve' | 'deny' | 'escalate' | 'continue';
}

/** Context passed to the permission evaluator for path-aware strategies */
export interface EvaluationContext {
  rootPath: string;              // Session's workspace root directory
  sessionType: SessionType;      // 'regular' or 'background'
}

/** Default sensitive file patterns */
export const DEFAULT_SENSITIVE_PATTERNS = [
  '.env*',
  '*credential*',
  '*.pem',
  '*.key',
  'id_rsa*',
  '*.p12',
  '*.pfx',
  '*secret*',
];
