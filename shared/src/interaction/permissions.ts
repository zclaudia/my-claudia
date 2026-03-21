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

/** Category-based permission policy — replaces trust-level system */
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

export const DEFAULT_CATEGORY_PROFILES: CategoryPermissionPolicy['profiles'] = {
  regular: {
    fileRead: 'auto-approve',
    fileWrite: 'auto-approve',
    shellSafe: 'auto-approve',
    networkOps: 'ask',
    destructiveOps: 'block',
    userQuestions: 'ask',
  },
  background: {
    fileRead: 'auto-approve',
    fileWrite: 'auto-approve',
    shellSafe: 'auto-approve',
    networkOps: 'block',
    destructiveOps: 'block',
    userQuestions: 'ask',
  },
  agent: {
    fileRead: 'auto-approve',
    fileWrite: 'ask',
    shellSafe: 'ask',
    networkOps: 'ask',
    destructiveOps: 'block',
    userQuestions: 'ask',
  },
};

export const DEFAULT_GLOBAL_GUARDS: GlobalGuards = {
  blockSensitiveFiles: true,
  blockOutsideWorkspace: true,
};

export const DEFAULT_CATEGORY_POLICY: CategoryPermissionPolicy = {
  enabled: true,
  profiles: DEFAULT_CATEGORY_PROFILES,
  globalGuards: DEFAULT_GLOBAL_GUARDS,
  customRules: [],
  escalateAlways: ['AskUserQuestion', 'ExitPlanMode'],
};

/** Context passed to the permission evaluator for path-aware evaluation */
export interface EvaluationContext {
  rootPath: string;              // Session's workspace root directory
  sessionType: SessionType;      // 'regular', 'background', or 'agent'
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
