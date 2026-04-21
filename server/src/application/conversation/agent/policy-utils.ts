/**
 * Permission policy utilities — normalization, merging, and database accessors.
 * Handles v1 (trustLevel), v2 (profiles), and v3 (unified) policy formats.
 */
import type {
  AgentPermissionPolicy,
  CategoryProfile,
  UnifiedPermissionPolicy,
  EvaluationContext,
} from '@my-claudia/shared/interaction/permissions';
import {
  DEFAULT_UNIFIED_POLICY,
  DEFAULT_UNIFIED_PROFILE,
  normalizeToUnifiedPolicy,
  ensureEscalateAlways,
} from '@my-claudia/shared/interaction/permissions';

/** @deprecated Alias — all policies are now UnifiedPermissionPolicy */
export type EffectivePolicy = UnifiedPermissionPolicy;

/** @deprecated Always true — kept for backward compat of callers */
export function isUnifiedPolicy(_policy: EffectivePolicy): _policy is UnifiedPermissionPolicy {
  return true;
}

/** Resolve the active CategoryProfile from a policy */
export function resolveProfile(policy: EffectivePolicy, _context?: EvaluationContext): CategoryProfile {
  return policy.profile;
}

/**
 * Detect whether a raw policy object is the old trustLevel format or new category format.
 */
function isLegacyPolicy(raw: unknown): raw is AgentPermissionPolicy {
  return raw !== null && typeof raw === 'object' && 'trustLevel' in (raw as Record<string, unknown>);
}

/**
 * Convert a legacy v1 trustLevel to a single CategoryProfile (v3).
 *
 * NOTE: v1/v2 had per-session-type profiles (regular/background/agent) where
 * background and agent sessions used stricter defaults (e.g. network blocked
 * for background, fileWrite=ask for agent). v3 intentionally unified to a
 * single profile for simplicity. The global settings UI has been v3-only since
 * its introduction. Legacy v1 data is converted using the `regular` profile,
 * which means old background/agent-specific restrictions are NOT preserved.
 * This is by design — administrators should use the unified profile to set
 * the desired policy across all session types.
 */
function trustLevelToProfile(trustLevel: string): CategoryProfile {
  switch (trustLevel) {
    case 'conservative':
      return { fileRead: 'auto-approve', fileWrite: 'ask', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' };
    case 'moderate':
      return { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'ask', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' };
    case 'aggressive':
      return { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'ask', destructiveOps: 'block', userQuestions: 'ask' };
    case 'full_trust':
      return { fileRead: 'auto-approve', fileWrite: 'auto-approve', shellSafe: 'auto-approve', networkOps: 'auto-approve', destructiveOps: 'block', userQuestions: 'ask' };
    default:
      return { ...DEFAULT_UNIFIED_PROFILE };
  }
}

/**
 * Normalize a policy from the database — handles v3 unified, v2 category, and v1 trustLevel formats.
 * Always returns UnifiedPermissionPolicy (v3).
 */
export function normalizePolicy(raw: unknown): UnifiedPermissionPolicy {
  if (!raw || typeof raw !== 'object') return DEFAULT_UNIFIED_POLICY;

  // v1 format: trustLevel-based — convert to v3
  if (isLegacyPolicy(raw)) {
    return {
      enabled: raw.enabled ?? false,
      profile: trustLevelToProfile(raw.trustLevel),
      globalGuards: { ...DEFAULT_UNIFIED_POLICY.globalGuards },
      customRules: raw.customRules || [],
      escalateAlways: ensureEscalateAlways(raw.escalateAlways),
      aiReview: { ...DEFAULT_UNIFIED_POLICY.aiReview },
    };
  }

  // v2/v3: delegate to shared
  return normalizeToUnifiedPolicy(raw);
}

/**
 * Merge a project-level override into the global policy.
 */
export function mergePolicy(
  globalPolicy: UnifiedPermissionPolicy,
  projectOverride?: Partial<UnifiedPermissionPolicy> | null
): UnifiedPermissionPolicy {
  if (!projectOverride) return globalPolicy;

  const merged: UnifiedPermissionPolicy = {
    ...globalPolicy,
    profile: { ...globalPolicy.profile, ...projectOverride.profile },
    globalGuards: { ...globalPolicy.globalGuards, ...projectOverride.globalGuards },
    aiReview: { ...globalPolicy.aiReview, ...projectOverride.aiReview },
  };

  if (projectOverride.enabled !== undefined) merged.enabled = projectOverride.enabled;
  if (projectOverride.customRules !== undefined) merged.customRules = projectOverride.customRules;
  if (projectOverride.escalateAlways !== undefined) merged.escalateAlways = projectOverride.escalateAlways;

  return merged;
}

/**
 * Read agent permission policy from database (handles v1/v2/v3 formats, always returns v3).
 */
export function getAgentPermissionPolicy(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement.get() uses variadic params
  db: { prepare: (sql: string) => { get: (...args: any[]) => Record<string, unknown> | undefined } }
): UnifiedPermissionPolicy | null {
  try {
    const row = db.prepare(
      'SELECT permission_policy FROM agent_config WHERE id = 1'
    ).get() as { permission_policy: string | null } | undefined;

    if (!row?.permission_policy) return null;

    const raw = JSON.parse(row.permission_policy);
    return normalizePolicy(raw);
  } catch {
    return null;
  }
}

/**
 * Read project-level agent permission override from database.
 */
export function getProjectPermissionOverride(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- better-sqlite3 Statement.get() uses variadic params
  db: { prepare: (sql: string) => { get: (...args: any[]) => Record<string, unknown> | undefined } },
  projectId: string
): Partial<UnifiedPermissionPolicy> | null {
  try {
    const row = db.prepare(
      'SELECT agent_permission_override FROM projects WHERE id = ?'
    ).get(projectId) as { agent_permission_override: string | null } | undefined;

    if (!row?.agent_permission_override) return null;

    const raw = JSON.parse(row.agent_permission_override);
    // If legacy format, convert and extract profile
    if (isLegacyPolicy(raw)) {
      const converted = normalizePolicy(raw);
      return { profile: converted.profile } as Partial<UnifiedPermissionPolicy>;
    }
    // If v2 format with profiles, extract regular as profile
    const obj = raw as Record<string, unknown>;
    if ('profiles' in obj && !('profile' in obj)) {
      const profiles = obj.profiles as Record<string, CategoryProfile>;
      return { profile: profiles.regular, ...('globalGuards' in obj ? { globalGuards: obj.globalGuards } : {}) } as Partial<UnifiedPermissionPolicy>;
    }
    return raw as Partial<UnifiedPermissionPolicy>;
  } catch {
    return null;
  }
}
