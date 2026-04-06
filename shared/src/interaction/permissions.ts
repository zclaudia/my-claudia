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

/** @deprecated Use CategoryPermissionPolicy instead. Kept for backward compat parsing. */
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

// ============================================
// Category-Based Permission Policy (v2)
// ============================================

/** The six operation categories for permission evaluation */
export type PermissionCategory = 'fileRead' | 'fileWrite' | 'shellSafe' | 'networkOps' | 'destructiveOps' | 'userQuestions';

/** Per-category action */
export type CategoryAction = 'auto-approve' | 'ask' | 'block';

/** One session profile: maps each category to an action */
export type CategoryProfile = Record<PermissionCategory, CategoryAction>;

/** Global guard toggles (always checked regardless of category) */
export interface GlobalGuards {
  blockSensitiveFiles: boolean;   // .env, .ssh, credentials → escalate
  blockOutsideWorkspace: boolean; // Outside workspace → escalate
}

/** @deprecated Use UnifiedPermissionPolicy instead. Kept for backward compat parsing. */
export interface CategoryPermissionPolicy {
  enabled: boolean;

  /** Per-session-type profiles */
  profiles: {
    regular: CategoryProfile;     // Coding sessions
    background: CategoryProfile;  // Supervisor sessions
    agent: CategoryProfile;       // Agent assistant sessions
  };

  globalGuards: GlobalGuards;

  /** Custom rules (first-match override, same as before) */
  customRules: AgentPermissionRule[];

  /** Tools that always escalate regardless of category */
  escalateAlways: string[];
}

// ============================================
// Unified Permission Policy (v3)
// ============================================

/** Result of an AI review for an escalated permission request */
export interface AIReviewMetadata {
  payloadDisposition?: 'safe_to_send' | 'send_with_redaction' | 'do_not_send';
  redactionCount?: number;
  reviewedFileCount?: number;
}

export interface AIReviewResult {
  decision: 'approve' | 'deny' | 'uncertain';
  reasoning: string;
  confidence: number;
  metadata?: AIReviewMetadata;
}

/** AI review configuration for blacklisted/escalated commands */
export interface AIReviewConfig {
  enabled: boolean;
  /** Seconds to wait for user before triggering AI review. Default 60. */
  timeoutBeforeReview: number;
  /** Confidence threshold (0-1). Below this, keep waiting for user. Default 0.8 */
  confidenceThreshold: number;
  /** Rate limit: max auto-approvals per minute. Default 10 */
  maxAutoApprovalsPerMinute: number;
  /** Provider for LLM risk analysis (optional, uses default if not set) */
  analysisProviderId?: string;
}

/** Unified permission policy — single profile for all session types */
export interface UnifiedPermissionPolicy {
  enabled: boolean;

  /** Single profile applied to ALL session types */
  profile: CategoryProfile;

  globalGuards: GlobalGuards;

  /** Custom rules (first-match override, same as before) */
  customRules: AgentPermissionRule[];

  /** Tools that always escalate to user (interactive tools, no AI review) */
  escalateAlways: string[];

  /** AI review configuration for escalated commands on timeout */
  aiReview: AIReviewConfig;
}

export const DEFAULT_AI_REVIEW_CONFIG: AIReviewConfig = {
  enabled: true,
  timeoutBeforeReview: 60,
  confidenceThreshold: 0.8,
  maxAutoApprovalsPerMinute: 10,
};

export const DEFAULT_UNIFIED_PROFILE: CategoryProfile = {
  fileRead: 'auto-approve',
  fileWrite: 'auto-approve',
  shellSafe: 'auto-approve',
  networkOps: 'auto-approve',
  destructiveOps: 'ask',
  userQuestions: 'ask',
};

export const DEFAULT_GLOBAL_GUARDS: GlobalGuards = {
  blockSensitiveFiles: true,
  blockOutsideWorkspace: false,
};

export const DEFAULT_UNIFIED_POLICY: UnifiedPermissionPolicy = {
  enabled: true,
  profile: DEFAULT_UNIFIED_PROFILE,
  globalGuards: DEFAULT_GLOBAL_GUARDS,
  customRules: [],
  escalateAlways: ['AskUserQuestion', 'ExitPlanMode'],
  aiReview: DEFAULT_AI_REVIEW_CONFIG,
};

function cloneUnifiedPolicy(policy: UnifiedPermissionPolicy): UnifiedPermissionPolicy {
  return {
    enabled: policy.enabled,
    profile: { ...policy.profile },
    globalGuards: { ...policy.globalGuards },
    customRules: [...policy.customRules],
    escalateAlways: [...policy.escalateAlways],
    aiReview: { ...policy.aiReview },
  };
}


/** Ensure AskUserQuestion and ExitPlanMode are always in the escalateAlways list */
export function ensureEscalateAlways(list?: string[]): string[] {
  const result = [...(list || ['AskUserQuestion'])];
  if (!result.includes('ExitPlanMode')) result.push('ExitPlanMode');
  return result;
}

/**
 * Normalize a raw policy object to UnifiedPermissionPolicy (v3).
 * Handles v3 (profile), v2 (profiles), and unknown/v1 formats.
 * For full v1 trustLevel conversion, use the server's normalizePolicy instead.
 */
export function normalizeToUnifiedPolicy(raw: unknown): UnifiedPermissionPolicy {
  if (!raw || typeof raw !== 'object') return cloneUnifiedPolicy(DEFAULT_UNIFIED_POLICY);

  const obj = raw as Record<string, unknown>;

  // v3: has `profile` (singular), no `profiles`
  if ('profile' in obj && !('profiles' in obj)) {
    const policy = raw as UnifiedPermissionPolicy;
    return {
      enabled: policy.enabled ?? true,
      profile: { ...DEFAULT_UNIFIED_PROFILE, ...policy.profile },
      globalGuards: { ...DEFAULT_GLOBAL_GUARDS, ...policy.globalGuards },
      customRules: policy.customRules || [],
      escalateAlways: ensureEscalateAlways(policy.escalateAlways),
      aiReview: { ...DEFAULT_AI_REVIEW_CONFIG, ...policy.aiReview },
    };
  }

  // v2: has `profiles` (plural) — collapse to single profile using `regular`
  if ('profiles' in obj) {
    const policy = raw as CategoryPermissionPolicy;
    return {
      enabled: policy.enabled ?? true,
      profile: { ...DEFAULT_UNIFIED_PROFILE, ...policy.profiles?.regular },
      globalGuards: { ...DEFAULT_GLOBAL_GUARDS, ...policy.globalGuards },
      customRules: policy.customRules || [],
      escalateAlways: ensureEscalateAlways(policy.escalateAlways),
      aiReview: { ...DEFAULT_AI_REVIEW_CONFIG },
    };
  }

  // v1 (trustLevel) or unknown — use defaults
  return cloneUnifiedPolicy(DEFAULT_UNIFIED_POLICY);
}

/** Context passed to the permission evaluator for path-aware evaluation */
export interface EvaluationContext {
  rootPath: string;              // Session's workspace root directory
  sessionType?: SessionType;     // Optional, no longer used for profile lookup
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
