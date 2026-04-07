import type { PCPProviderManifest, PCPPermissionMode } from '@my-claudia/shared/core/pcp';
import type { PermissionMode } from '@my-claudia/shared/core/provider';

const LEGACY_TO_PCP_MODE: Record<PermissionMode, PCPPermissionMode> = {
  default: 'supervised',
  acceptEdits: 'auto_edit',
  bypassPermissions: 'autonomous',
  plan: 'plan_only',
};

function isPcpPermissionMode(mode: string): mode is PCPPermissionMode {
  return mode === 'supervised' || mode === 'auto_edit' || mode === 'autonomous' || mode === 'plan_only';
}

export function normalizePermissionMode(mode?: string): PCPPermissionMode | undefined {
  if (!mode) return undefined;
  if (isPcpPermissionMode(mode)) return mode;
  return LEGACY_TO_PCP_MODE[mode as PermissionMode];
}

/**
 * Map a PCP standard permission mode to the provider's native mode string.
 * Falls back to the safest supported mode if the requested mode is unavailable.
 */
export function mapPermissionMode(
  manifest: PCPProviderManifest,
  requestedMode?: string,
): string {
  const map = manifest.permissionModeMap;
  if (!map) return requestedMode || 'default';

  if (!requestedMode) {
    return map.supervised ?? Object.values(map)[0] ?? 'default';
  }

  const pcpMode = normalizePermissionMode(requestedMode);
  if (!pcpMode) {
    return requestedMode;
  }

  // Direct mapping
  const mapped = map[pcpMode];
  if (mapped) return mapped;

  // Fallback: always degrade toward stricter modes
  // autonomous → auto_edit → supervised → plan_only
  const fallbackMap: Record<PCPPermissionMode, PCPPermissionMode[]> = {
    autonomous: ['auto_edit', 'supervised'],
    auto_edit: ['supervised'],
    supervised: [],
    plan_only: ['supervised'],
  };
  const fallbackChain = fallbackMap[pcpMode] || [];

  for (const fallback of fallbackChain) {
    const fallbackMapped = map[fallback];
    if (fallbackMapped) return fallbackMapped;
  }

  // Last resort: supervised or first available
  return map.supervised ?? Object.values(map)[0] ?? 'default';
}

/**
 * Check if a provider supports a specific PCP permission mode.
 */
export function supportsPermissionMode(
  manifest: PCPProviderManifest,
  pcpMode: PCPPermissionMode,
): boolean {
  return !!manifest.permissionModeMap?.[pcpMode];
}

/**
 * Get all PCP permission modes supported by a provider.
 */
export function getSupportedPermissionModes(
  manifest: PCPProviderManifest,
): PCPPermissionMode[] {
  if (!manifest.permissionModeMap) return [];
  return Object.keys(manifest.permissionModeMap) as PCPPermissionMode[];
}
