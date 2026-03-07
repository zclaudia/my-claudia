/**
 * Tool Registry - Centralized tool registration and execution.
 *
 * This registry enables dynamic registration of tools for both built-in
 * and plugin-provided functionality. It follows the same pattern as
 * ProviderRegistry in the server.
 *
 * Usage:
 *   // Register a tool
 *   toolRegistry.register({
 *     id: 'my_tool',
 *     definition: { type: 'function', function: { name: 'my_tool', ... } },
 *     handler: async (args) => { ... },
 *     source: 'plugin',
 *     pluginId: 'com.example.my-plugin',
 *   });
 *
 *   // Get all definitions for AI
 *   const definitions = toolRegistry.getAllDefinitions();
 *
 *   // Execute a tool
 *   const result = await toolRegistry.execute(toolCall, context);
 */

import type { ToolDefinition, ToolCall } from './clientAI';
import type { ClientMessage } from '@my-claudia/shared';

// ============================================
// Types
// ============================================

/** Optional context for tools that need WebSocket access (meta-agent tools). */
export interface ToolExecutionContext {
  /** Send a WebSocket message (e.g., run_start) */
  sendWsMessage?: (message: ClientMessage) => void;
  /** Whether a WebSocket connection is active */
  isConnected?: boolean;
}

export type ToolHandler = (
  args: Record<string, unknown>,
  context?: ToolExecutionContext
) => Promise<string> | string;

export type ToolSource = 'builtin' | 'plugin';

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
   * Get all tool metadata.
   */
  getAll(): ToolMeta[] {
    return Array.from(this.tools.values());
  }

  /**
   * Execute a tool call.
   * @param toolCall - The tool call from the AI
   * @param context - Optional execution context
   * @returns The tool result as a JSON string
   */
  async execute(toolCall: ToolCall, context?: ToolExecutionContext): Promise<string> {
    const toolName = toolCall.function.name;
    const tool = this.tools.get(toolName);

    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }

    try {
      const args = JSON.parse(toolCall.function.arguments);
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
export function registerTool(registration: ToolRegistration, source: ToolSource = 'plugin', pluginId?: string): void {
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
