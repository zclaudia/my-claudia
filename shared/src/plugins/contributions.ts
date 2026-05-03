import type { Permission } from './permissions.js';

export interface CommandContribution {
  command: string; // e.g., '/my-command'
  title: string;
  category?: string;
  icon?: string;
}

export interface ToolContribution {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  scope?: ('agent-assistant' | 'main-session' | 'command-palette')[];
  permissions?: Permission[];
}

export interface SettingsContribution {
  id: string;
  label: string;
  icon?: string;
  schema?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
}

export interface PanelContribution {
  id: string;
  label: string;
  location: 'bottom' | 'sidebar' | 'right';
  icon?: string;
  size?: number;
  /** Relative path to the HTML entry for third-party iframe panels (e.g. "ui/index.html") */
  frontend?: string;
  order?: number;
}

export interface HookContribution {
  event: string;
  handler: string;
  priority?: number;
}

export interface MenuContribution {
  id: string;
  location: 'context-menu' | 'toolbar' | 'status-bar';
  label: string;
  command?: string;
  icon?: string;
  when?: string;
}

export interface KeybindingContribution {
  command: string;
  key: string;
  when?: string;
}

export interface UIExtensionPoint {
  id: string;
  location: 'sidebar' | 'panel' | 'toolbar' | 'context-menu' | 'status-bar';
  component?: string; // Path to component module
  when?: string;
}

export interface WorkflowStepContribution {
  id: string;
  name: string;
  description: string;
  category?: string;
  icon?: string;
  configSchema?: Record<string, unknown>;
}

export interface TriggerSourceContribution {
  /** Local ID within the plugin (will be namespaced as 'pluginId/id') */
  id: string;
  name: string;
  description: string;
  /** Event pattern this source emits (supports globs: 'run.*', '**') */
  eventPattern: string;
  category?: string;
  icon?: string;
}

export type WorkflowStepHandler = (
  config: Record<string, unknown>,
  context: {
    projectId?: string;
    projectRootPath?: string;
    providerId?: string;
    stepRunId: string;
    runId: string;
  },
) => Promise<{ status: 'completed' | 'failed'; output: Record<string, unknown>; error?: string }>;

export interface NotchTabContribution {
  /** Unique ID within the plugin (namespaced as 'pluginId/id' at runtime) */
  id: string;
  /** Display label in the tab bar (keep short, ≤8 chars recommended) */
  label: string;
  /** Optional icon name */
  icon?: string;
  /** Ordering among plugin tabs (lower = left) */
  order?: number;
}

export interface SkillContribution {
  /** Relative path to SKILL.md inside the plugin directory */
  path: string;
}

export interface PluginContributes {
  commands?: CommandContribution[];
  tools?: ToolContribution[];
  settings?: SettingsContribution;
  panels?: PanelContribution[];
  hooks?: HookContribution[];
  uiExtensions?: UIExtensionPoint[];
  menus?: MenuContribution[];
  keybindings?: KeybindingContribution[];
  workflowSteps?: WorkflowStepContribution[];
  triggerSources?: TriggerSourceContribution[];
  skills?: SkillContribution[];
  notchTabs?: NotchTabContribution[];
}

export interface UIExtensionRegistration {
  id: string;
  location: 'sidebar' | 'panel' | 'toolbar' | 'context-menu' | 'status-bar';
  component: unknown; // Generic type, concrete React.ComponentType in desktop app
  when?: (context: unknown) => boolean;
}
