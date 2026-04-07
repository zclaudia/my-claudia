import type { PCPEffectiveProfile, PCPCapabilityId, ReliabilityTier } from '@my-claudia/shared/core/pcp';
import { hasCapability } from '@my-claudia/shared/core/pcp';

/** Mapping from interaction tool name to PCP capability ID */
const INTERACTION_TOOL_CAPABILITY_MAP: Record<string, PCPCapabilityId> = {
  'ask_user_form': 'interaction.form',
  'request_approval': 'interaction.approval',
  'update_todo_list': 'interaction.todo',
  'push_file': 'tool.inject',
};

/**
 * Check if an interaction tool should be available for the given provider profile.
 * Returns true if no profile is available (backwards compatibility).
 */
export function shouldExposeInteractionTool(
  toolName: string,
  profile?: PCPEffectiveProfile,
): boolean {
  if (!profile) return true; // No profile → default to exposing all tools

  const capId = INTERACTION_TOOL_CAPABILITY_MAP[toolName];
  if (!capId) return true; // Unknown tool → allow

  return hasCapability(profile, capId);
}

/**
 * Get the reliability tier of an interaction tool for UI hints.
 * Returns undefined if the tool is not capability-mapped.
 */
export function getInteractionReliability(
  toolName: string,
  profile?: PCPEffectiveProfile,
): ReliabilityTier | undefined {
  if (!profile) return undefined;

  const capId = INTERACTION_TOOL_CAPABILITY_MAP[toolName];
  if (!capId) return undefined;

  const cap = profile.capabilities.find(c => c.id === capId);
  return cap?.reliability;
}
