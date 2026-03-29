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

// === Input Modes ===

export type ImageAttachmentMode = 'data_uri' | 'file_path' | 'temp_file';

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

/** Get the degradation policy for a capability */
export function getDegradation(
  profile: PCPEffectiveProfile,
  id: PCPCapabilityId,
): DegradationPolicy {
  const cap = profile.capabilities.find(c => c.id === id);
  if (cap?.enabled) return cap.degradation ?? 'reject';
  return cap?.degradation ?? 'reject';
}
