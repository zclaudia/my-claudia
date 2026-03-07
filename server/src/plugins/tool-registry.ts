/**
 * Server-side Tool Registry
 *
 * This registry mirrors the structure of the desktop toolRegistry
 * for use in the server context. Tools registered here can be
 * synchronized with the desktop app via IPC.
 */

import type { ToolDefinition } from '@my-claudia/shared';
import { pluginLoader } from './loader.js';

// ============================================
// Types
// ============================================

export type ToolHandler = (
  args: Record<string, unknown>,
  context?: Record<string, unknown>
) => Promise<string> | string;

export type ToolSource = 'builtin' | 'plugin';

export type ToolScope = 'agent-assistant' | 'main-session' | 'command-palette';

export interface ToolMeta {
  /** Unique tool ID (typically matches function name) */
  id: string;
  /** Tool definition in OpenAI function calling format */
  definition: ToolDefinition;
  /** Handler function for tool execution */
  handler: ToolHandler;
  /** Required permissions (for plugins) */
  permissions?: string[];
  /** Source of the tool */
  source: ToolSource;
  /** Plugin ID if source is 'plugin' */
  pluginId?: string;
  /** Tool description for UI display */
  description?: string;
  /** Scope where this tool is available */
  scope?: ToolScope[];
}

export interface ToolRegistration {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler;
  permissions?: string[];
}

// ============================================
// Tool Registry
// ============================================

class ToolRegistry {
  private tools = new Map<string, ToolMeta>();

  /**
   * Register a tool.
   * If a tool with the same ID exists, it will be overwritten with a warning.
   */
  register(meta: ToolMeta): void {
    if (this.tools.has(meta.id)) {
      const existing = this.tools.get(meta.id)!;
      console.warn(
        `[ToolRegistry] Tool "${meta.id}" already registered by ${existing.source}` +
          (existing.pluginId ? ` (${existing.pluginId})` : '') +
          `. Overwriting with ${meta.source}` +
          (meta.pluginId ? ` (${meta.pluginId})` : '')
      );
    }
    this.tools.set(meta.id, meta);
  }

  /**
   * Unregister a tool by ID.
   * @returns true if the tool was removed, false if it didn't exist
   */
  unregister(toolId: string): boolean {
    return this.tools.delete(toolId);
  }

  /**
   * Get a tool's metadata by ID.
   */
  get(toolId: string): ToolMeta | undefined {
    return this.tools.get(toolId);
  }

  /**
   * Check if a tool exists.
   */
  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  /**
   * Get all tool definitions for sending to AI providers.
   */
  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Get definitions filtered by source.
   */
  getDefinitionsBySource(source: ToolSource): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => t.source === source)
      .map((t) => t.definition);
  }

  /**
   * Get definitions filtered by scope.
   * Tools without a scope defined are considered available in all scopes.
   */
  getDefinitionsByScope(scope: ToolScope): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((t) => !t.scope || t.scope.includes(scope))
      .map((t) => t.definition);
  }

  /**
   * Get all tool metadata.
   */
  getAll(): ToolMeta[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool call.
   * @param toolName - The tool name
   * @param args - The tool arguments
   * @param context - Optional execution context
   * @returns The tool result as a JSON string
   */
  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context?: Record<string, unknown>
  ): Promise<string> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }

    try {
      // Lazy permission check: request permissions on first use if not yet granted
      if (tool.pluginId) {
        const permitted = await pluginLoader.checkPermissions(tool.pluginId);
        if (!permitted) {
          return JSON.stringify({ error: `Plugin "${tool.pluginId}" permissions denied` });
        }
      }

      const result = await tool.handler(args, context);
      return result;
    } catch (error) {
      return JSON.stringify({
        error: `Tool execution failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  /**
   * Get all tools registered by a specific plugin.
   */
  getByPlugin(pluginId: string): ToolMeta[] {
    return Array.from(this.tools.values()).filter((t) => t.pluginId === pluginId);
  }

  /**
   * Clear all tools registered by a specific plugin.
   * Called when a plugin is deactivated or uninstalled.
   */
  clearByPlugin(pluginId: string): number {
    let count = 0;
    for (const [id, tool] of this.tools) {
      if (tool.pluginId === pluginId) {
        this.tools.delete(id);
        count++;
      }
    }
    return count;
  }

  /**
   * Get the number of registered tools.
   */
  get size(): number {
    return this.tools.size;
  }

  /**
   * Clear all registered tools (mainly for testing).
   */
  clear(): void {
    this.tools.clear();
  }
}

// ============================================
// Singleton Export
// ============================================

export const toolRegistry = new ToolRegistry();

// ============================================
// Convenience Registration Helper
// ============================================

/**
 * Register a tool with a simpler API (useful for plugins).
 */
export function registerTool(
  registration: ToolRegistration,
  source: ToolSource = 'plugin',
  pluginId?: string
): void {
  toolRegistry.register({
    id: registration.id,
    definition: {
      type: 'function',
      function: {
        name: registration.name,
        description: registration.description,
        parameters: registration.parameters,
      },
    },
    handler: registration.handler,
    permissions: registration.permissions,
    source,
    pluginId,
  });
}
