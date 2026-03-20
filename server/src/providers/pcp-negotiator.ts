import type {
  PCPProviderManifest,
  PCPEffectiveProfile,
  PCPEffectiveCapability,
  PCPCapabilityId,
  DegradationPolicy,
} from '@my-claudia/shared';
import { normalizePermissionMode } from './pcp-permission.js';

/** Default degradation policies per capability */
const DEFAULT_DEGRADATION: Partial<Record<PCPCapabilityId, DegradationPolicy>> = {
  'chat.generate': 'reject',
  'chat.stream': 'fallback_to_text',
  'tool.call': 'reject',
  'tool.inject': 'reject',
  'interaction.form': 'fallback_to_notice',
  'interaction.approval': 'reject',
  'interaction.todo': 'fallback_to_notice',
  'input.image': 'reject',
  'input.text_file': 'reject',
  'input.binary_file': 'reject',
  'permission.mode': 'reject',
  'session.abort': 'reject',
  'session.background_task': 'reject',
};

export interface NegotiationContext {
  model?: string;
  mode?: string;
  hasMcpBridge?: boolean;
  serverPort?: number | null;
}

/**
 * Compute the effective capability profile for a provider in a given run context.
 * Static manifest + runtime context → actual available capabilities.
 */
export function negotiateProfile(
  manifest: PCPProviderManifest,
  context: NegotiationContext,
): PCPEffectiveProfile {
  const normalizedMode = normalizePermissionMode(context.mode);
  const capabilities: PCPEffectiveCapability[] = manifest.capabilities.map(cap => {
    let enabled = cap.supported;
    let reason: string | undefined;

    // MCP bridge required for bridged capabilities
    if (cap.mode === 'bridged' && !context.hasMcpBridge) {
      enabled = false;
      reason = 'MCP bridge not available';
    }

    // tool.inject requires server port for MCP bridge
    if (cap.id === 'tool.inject' && !context.serverPort) {
      enabled = false;
      reason = 'Server port not available for MCP bridge';
    }

    // plan_only mode disables approval (no actions to approve)
    if (cap.id === 'interaction.approval' && normalizedMode === 'plan_only') {
      enabled = false;
      reason = 'Plan-only mode: no actions require approval';
    }

    return {
      id: cap.id,
      enabled,
      mode: cap.mode,
      reliability: cap.reliability,
      degradation: cap.degradation ?? DEFAULT_DEGRADATION[cap.id] ?? 'reject',
      reason: enabled ? undefined : reason,
    };
  });

  return {
    providerId: manifest.id,
    providerType: manifest.providerType,
    sessionId: undefined,
    model: context.model,
    capabilities,
    negotiatedAt: Date.now(),
  };
}
