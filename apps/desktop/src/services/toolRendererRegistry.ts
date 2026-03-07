/**
 * Tool Renderer Registry
 *
 * Allows plugins to register custom React components for rendering
 * specific tool calls in the chat UI. When a tool call is displayed,
 * the registry is checked first — if a custom renderer exists, it is
 * used instead of the default rendering logic in ToolCallItem.
 */

import type { ComponentType } from 'react';

// ============================================
// Types
// ============================================

export interface ToolRendererProps {
  toolName: string;
  toolInput: unknown;
  toolResult?: unknown;
  isError?: boolean;
  isLoading?: boolean;
}

// ============================================
// Registry
// ============================================

class ToolRendererRegistry {
  private renderers = new Map<string, ComponentType<ToolRendererProps>>();

  /**
   * Register a custom renderer for a tool name.
   * If a renderer already exists, it will be overwritten.
   */
  register(toolName: string, component: ComponentType<ToolRendererProps>): void {
    this.renderers.set(toolName, component);
  }

  /**
   * Unregister a custom renderer.
   */
  unregister(toolName: string): void {
    this.renderers.delete(toolName);
  }

  /**
   * Get the custom renderer for a tool name, if any.
   */
  get(toolName: string): ComponentType<ToolRendererProps> | undefined {
    return this.renderers.get(toolName);
  }

  /**
   * Check if a custom renderer is registered for a tool name.
   */
  has(toolName: string): boolean {
    return this.renderers.has(toolName);
  }

  /**
   * Clear all registered renderers by plugin ID prefix.
   */
  clearByPrefix(prefix: string): number {
    let count = 0;
    for (const [name] of this.renderers) {
      if (name.startsWith(prefix)) {
        this.renderers.delete(name);
        count++;
      }
    }
    return count;
  }

  /**
   * Clear all registered renderers.
   */
  clear(): void {
    this.renderers.clear();
  }

  /**
   * Get the number of registered renderers.
   */
  get size(): number {
    return this.renderers.size;
  }
}

export const toolRendererRegistry = new ToolRendererRegistry();
