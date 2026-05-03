import type { Permission } from './permissions.js';
import type { PluginContributes } from './contributions.js';
import type { PluginRequirements } from './capabilities.js';

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface PluginEngines {
  claudia: string; // semver range, e.g., ">=0.1.0"
}

export type ExecutionMode = 'main' | 'worker' | 'sandbox';

/**
 * Plugin platform scope.
 * - 'universal': Works everywhere (pure backend — tools, commands, events, workflow steps)
 * - 'desktop': Requires desktop UI (has panels, toolbars, or other UI extensions)
 */
export type PluginPlatform = 'universal' | 'desktop';

export interface PluginManifest {
  id: string; // e.g., 'com.example.my-plugin'
  name: string;
  version: string;
  description: string;
  author?: PluginAuthor;
  icon?: string;

  main?: string; // Backend entry (server-side)
  frontend?: string; // Frontend entry (UI extensions)

  permissions?: Permission[];

  contributes?: PluginContributes;

  // 平台作用域 — 未声明时根据 contributes 自动推断
  platform?: PluginPlatform;

  // 执行模式
  executionMode?: ExecutionMode;

  // 激活事件
  activationEvents?: string[];

  // 兼容性声明
  engines?: PluginEngines;

  // 插件依赖
  dependencies?: Record<string, string>; // pluginId → semver range

  // 外部能力需求声明
  requires?: PluginRequirements;
}

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export function validatePluginManifest(manifest: unknown): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'], warnings: [] };
  }

  const m = manifest as Record<string, unknown>;

  if (!m.id || typeof m.id !== 'string') {
    errors.push('Missing required field: id');
  } else if (!/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/.test(m.id as string)) {
    errors.push('Invalid id format (use reverse domain notation, e.g., com.example.plugin)');
  }

  if (!m.name || typeof m.name !== 'string') {
    errors.push('Missing required field: name');
  }

  if (!m.version || typeof m.version !== 'string') {
    errors.push('Missing required field: version');
  } else if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version as string)) {
    warnings.push('Version should follow semver format (e.g., 1.0.0)');
  }

  if (!m.description || typeof m.description !== 'string') {
    errors.push('Missing required field: description');
  }

  if (m.engines && typeof m.engines === 'object') {
    const engines = m.engines as Record<string, unknown>;
    if (!engines.claudia || typeof engines.claudia !== 'string') {
      warnings.push('engines.claudia should specify a semver range');
    }
  }

  if (m.contributes && typeof m.contributes === 'object') {
    const contributes = m.contributes as Record<string, unknown>;

    if (contributes.commands && Array.isArray(contributes.commands)) {
      for (const cmd of contributes.commands) {
        if (!cmd.command || typeof cmd.command !== 'string') {
          errors.push('Command contribution missing "command" field');
        }
        if (!cmd.title || typeof cmd.title !== 'string') {
          errors.push('Command contribution missing "title" field');
        }
      }
    }

    if (contributes.tools && Array.isArray(contributes.tools)) {
      for (const tool of contributes.tools) {
        if (!tool.id || typeof tool.id !== 'string') {
          errors.push('Tool contribution missing "id" field');
        }
        if (!tool.name || typeof tool.name !== 'string') {
          errors.push('Tool contribution missing "name" field');
        }
        if (!tool.description || typeof tool.description !== 'string') {
          errors.push('Tool contribution missing "description" field');
        }
      }
    }

    if (contributes.notchTabs && Array.isArray(contributes.notchTabs)) {
      for (const tab of contributes.notchTabs) {
        if (!tab.id || typeof tab.id !== 'string') {
          errors.push('NotchTab contribution missing "id" field');
        }
        if (!tab.label || typeof tab.label !== 'string') {
          errors.push('NotchTab contribution missing "label" field');
        }
      }
    }

    if (contributes.workflowSteps && Array.isArray(contributes.workflowSteps)) {
      for (const step of contributes.workflowSteps) {
        if (!step.id || typeof step.id !== 'string') {
          errors.push('WorkflowStep contribution missing "id" field');
        }
        if (!step.name || typeof step.name !== 'string') {
          errors.push('WorkflowStep contribution missing "name" field');
        }
        if (!step.description || typeof step.description !== 'string') {
          errors.push('WorkflowStep contribution missing "description" field');
        }
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

/**
 * Resolve the effective platform for a plugin.
 * If manifest.platform is set, use it. Otherwise infer from contributes:
 *   - Has panels, uiExtensions, menus, or keybindings → 'desktop'
 *   - Otherwise → 'universal'
 */
export function resolvePluginPlatform(manifest: PluginManifest): PluginPlatform {
  if (manifest.platform) return manifest.platform;

  const c = manifest.contributes;
  if (!c) return 'universal';

  const hasUI = (c.panels && c.panels.length > 0)
    || (c.uiExtensions && c.uiExtensions.length > 0)
    || (c.menus && c.menus.length > 0)
    || (c.keybindings && c.keybindings.length > 0)
    || (c.notchTabs && c.notchTabs.length > 0)
    || !!manifest.frontend;

  return hasUI ? 'desktop' : 'universal';
}
