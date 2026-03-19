// Provider Types

export const PROVIDER_TYPES = ['claude', 'opencode', 'codex', 'cursor', 'kimi'] as const;
export type ProviderType = typeof PROVIDER_TYPES[number];

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  cliPath?: string;
  env?: Record<string, string>;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

// Provider Capabilities (drives UI selectors)

/** Permission modes supported by Claude SDK */
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

/** A selectable option in the Mode dropdown (permission mode, agent, etc.) */
export interface ModeOption {
  id: string;           // Value sent to server (e.g. 'default', 'plan', 'build')
  label: string;        // Display text (e.g. 'Default', 'Plan')
  description?: string; // Tooltip / subtitle
  icon?: string;        // Emoji or icon identifier
}

/** A selectable option in the Model dropdown */
export interface ModelOption {
  id: string;           // Value sent to server (e.g. 'claude-sonnet-4-5-20250929')
  label: string;        // Display text (e.g. 'Sonnet')
  group?: string;       // Optional grouping (e.g. provider name in OpenCode)
}

/** What a provider supports — drives the UI selectors */
export interface ProviderCapabilities {
  modes: ModeOption[];    // Empty array → hide mode selector entirely
  models: ModelOption[];  // Empty array → hide model selector entirely
  modeLabel?: string;     // Custom label: "Mode" (Claude) / "Agent" (OpenCode)
  modelLabel?: string;    // Custom label: "Model" for all
  defaultModeId?: string; // Which mode is selected by default
}
