// Delegation Mode Types — AI-assisted permission auto-resolution

import type { PermissionCategory } from '../interaction/permissions.js';

export interface DelegationConfig {
  enabled: boolean;
  /** Confidence threshold (0-1). Below this, escalate to user. Default 0.8 */
  confidenceThreshold: number;
  /** Rate limit: max auto-approvals per minute. Default 10 */
  maxAutoApprovalsPerMinute: number;
  /** Which permission categories can be delegated */
  allowedCategories: PermissionCategory[];
  /** Tool names that should never be auto-approved */
  neverDelegate: string[];
  /** Provider for LLM risk analysis (optional, uses default if not set) */
  analysisProviderId?: string;
}

export const DEFAULT_DELEGATION_CONFIG: DelegationConfig = {
  enabled: false,
  confidenceThreshold: 0.8,
  maxAutoApprovalsPerMinute: 10,
  allowedCategories: ['fileRead', 'fileWrite', 'shellSafe'],
  neverDelegate: ['AskUserQuestion', 'ExitPlanMode'],
  analysisProviderId: undefined,
};

export interface DelegationDecision {
  decision: 'approve' | 'deny' | 'escalate';
  reasoning: string;
  confidence: number;
  source: 'rule' | 'llm';
}
