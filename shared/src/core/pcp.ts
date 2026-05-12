// Provider Capability Protocol (PCP) v1
// Defines the capability standard for AI provider nodes in workflows.

// === Capability IDs ===

export type PCPCapabilityId =
  // Generation
  | 'chat.generate'
  | 'chat.stream'
  // Tooling
  | 'tool.call'
  | 'tool.inject'
  // Structured Interaction
  | 'interaction.form'
  | 'interaction.approval'
  | 'interaction.todo'
  // Input
  | 'input.image'
  | 'input.text_file'
  | 'input.binary_file'
  // Permission
  | 'permission.mode'
  // Session
  | 'session.abort'
  | 'session.background_task';

// === Capability Metadata ===

/** How the capability is implemented */
export type CapabilityMode = 'native' | 'bridged' | 'emulated';

/** How reliable the capability is */
export type ReliabilityTier = 'strict' | 'best_effort' | 'display_only';

/** What happens when the capability is unavailable */
export type DegradationPolicy = 'reject' | 'fallback_to_text' | 'fallback_to_notice' | 'server_emulation';

// === Unified Permission Modes ===

export type PCPPermissionMode = 'supervised' | 'auto_edit' | 'autonomous' | 'plan_only';

// === Capability Descriptor ===

export interface PCPCapabilityDescriptor {
  id: PCPCapabilityId;
  supported: boolean;
  mode?: CapabilityMode;
  reliability?: ReliabilityTier;
  degradation?: DegradationPolicy;
  limits?: Record<string, string | number | boolean>;
  notes?: string;
}

// === Provider Manifest ===

export type ProviderRuntimeKind = 'cli' | 'sdk' | 'http' | 'bridge';

export interface PCPProviderManifest {
  id: string;
  name: string;
  version: string;
  apiVersion: 'pcp/v1';

  providerType: string;
  runtime: ProviderRuntimeKind;

  capabilities: PCPCapabilityDescriptor[];

  /** PCP standard mode → provider native mode string */
  permissionModeMap?: Partial<Record<PCPPermissionMode, string>>;

  /**
   * Interaction tool IDs that this provider supports natively.
   * Tools listed here will NOT be injected via MCP bridge (to avoid conflicts).
   * Tools NOT listed here will be injected so the provider gains those capabilities.
   */
  nativeInteractionTools?: string[];

  /**
   * Message the runtime should inject as the assistant's reply if the run
   * completed with at least one tool call but no text output. Used by
   * providers (e.g. OpenCode) that sometimes finish without emitting a final
   * narrative — the alternative would be a silently empty assistant message.
   * Absence means "no fallback, allow empty replies".
   */
  emptyResultFallback?: string;

  /**
   * Working-directory policy when resuming a persisted session:
   *   - `'pinned'`   keep the original session root, ignore any new cwd the
   *                  client passes. Required for providers (e.g. Kimi) that
   *                  store sessions under work-dir-scoped storage, where
   *                  resuming with a different cwd silently creates a fresh
   *                  empty session.
   *   - `'requested'` (default) use whatever cwd the caller requests.
   */
  sessionCwdPolicy?: 'pinned' | 'requested';

  /**
   * Whether a provider-side session can be resumed when the next turn starts
   * in a non-default mode.
   *   - `'reset'` (default) drops the stored provider session so the requested
   *                  mode is definitely applied.
   *   - `'preserve'` keeps the stored provider session and passes the mode to
   *                  the provider alongside the resume id.
   */
  modeSwitchSessionPolicy?: 'reset' | 'preserve';

  /**
   * Auth-related error hint: when a raw provider error matches one of these
   * patterns the runtime rewrites the message to point the user at the
   * correct re-auth flow. Each entry is either a single case-insensitive
   * substring or an array (treated as all-of). The token `{raw}` in the
   * `message` is replaced with the original error.
   */
  authErrorHint?: {
    matchAny: Array<string | string[]>;
    message: string;
  };

  /**
   * Tool names this provider produces that must always escalate to the user
   * (e.g. plan-mode submissions, which need explicit approval). Unioned with
   * the user's policy at permission-evaluation time. Lets each provider keep
   * ownership of "which of MY tool names are interactive" instead of putting
   * the names into the shared default policy.
   */
  escalateAlwaysTools?: string[];
}

// === Effective Provider Profile ===

export interface PCPEffectiveCapability {
  id: PCPCapabilityId;
  enabled: boolean;
  mode?: CapabilityMode;
  reliability?: ReliabilityTier;
  degradation?: DegradationPolicy;
  reason?: string;
}

export interface PCPEffectiveProfile {
  providerId: string;
  providerType: string;
  sessionId?: string;
  model?: string;

  capabilities: PCPEffectiveCapability[];
  negotiatedAt: number;
}

// === Helpers ===

/** Check if a capability is enabled and meets minimum reliability */
export function hasCapability(
  profile: PCPEffectiveProfile,
  id: PCPCapabilityId,
  minReliability?: ReliabilityTier,
): boolean {
  const cap = profile.capabilities.find(c => c.id === id);
  if (!cap?.enabled) return false;
  if (!minReliability) return true;

  const tiers: ReliabilityTier[] = ['strict', 'best_effort', 'display_only'];
  const capTierIndex = tiers.indexOf(cap.reliability ?? 'best_effort');
  const minTierIndex = tiers.indexOf(minReliability);
  return capTierIndex <= minTierIndex;
}
