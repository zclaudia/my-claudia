import type { ToolDefinition } from '@my-claudia/shared/plugin-types';
import { pluginLoader } from './loader.js';

export type ToolHandler = (
  args: Record<string, unknown>,
  context?: Record<string, unknown>
) => Promise<string> | string;

export type ToolSource = 'builtin' | 'plugin' | 'interaction' | 'skill';

export type ToolScope = 'agent-assistant' | 'main-session' | 'command-palette';

export interface ToolMeta {
  id: string;
  definition: ToolDefinition;
  handler: ToolHandler;
  permissions?: string[];
  source: ToolSource;
  pluginId?: string;
  description?: string;
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

export class ToolRegistry {
  private tools = new Map<string, ToolMeta>();

  register(meta: ToolMeta): void {
    if (this.tools.has(meta.id)) {
      const existing = this.tools.get(meta.id)!;
      console.warn(
        `[ToolRegistry] Tool "${meta.id}" already registered by ${existing.source}` +
          (existing.pluginId ? ` (${existing.pluginId})` : '') +
          `. Overwriting with ${meta.source}` +
          (meta.pluginId ? ` (${meta.pluginId})` : ''),
      );
    }
    this.tools.set(meta.id, meta);
  }

  unregister(toolId: string): boolean {
    return this.tools.delete(toolId);
  }

  get(toolId: string): ToolMeta | undefined {
    return this.tools.get(toolId);
  }

  has(toolId: string): boolean {
    return this.tools.has(toolId);
  }

  getAllDefinitions(): ToolDefinition[] {
    return Array.from(this.tools.values()).map((tool) => tool.definition);
  }

  getDefinitionsBySource(source: ToolSource): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((tool) => tool.source === source)
      .map((tool) => tool.definition);
  }

  getDefinitionsByScope(scope: ToolScope): ToolDefinition[] {
    return Array.from(this.tools.values())
      .filter((tool) => !tool.scope || tool.scope.includes(scope))
      .map((tool) => tool.definition);
  }

  getAll(): ToolMeta[] {
    return Array.from(this.tools.values());
  }

  async execute(
    toolName: string,
    args: Record<string, unknown>,
    context?: Record<string, unknown>,
    scope?: ToolScope,
  ): Promise<string> {
    const tool = this.tools.get(toolName);

    if (!tool) {
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }

    if (scope && tool.scope && tool.scope.length > 0 && !tool.scope.includes(scope)) {
      return JSON.stringify({ error: `Tool "${toolName}" not available in scope "${scope}"` });
    }

    try {
      if (tool.pluginId) {
        const permitted = await pluginLoader.checkPermissions(tool.pluginId);
        if (!permitted) {
          const pending = pluginLoader.getPendingPermissions(tool.pluginId);
          return JSON.stringify({
            error: 'permissions_required',
            pluginId: tool.pluginId,
            permissions: pending || [],
          });
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

  getByPlugin(pluginId: string): ToolMeta[] {
    return Array.from(this.tools.values()).filter((tool) => tool.pluginId === pluginId);
  }

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

  removeBySource(source: ToolSource): number {
    let count = 0;
    for (const [id, tool] of this.tools) {
      if (tool.source === source) {
        this.tools.delete(id);
        count++;
      }
    }
    return count;
  }

  getBridgeTools(): ToolMeta[] {
    return Array.from(this.tools.values()).filter(
      (tool) => tool.source === 'plugin' || tool.source === 'interaction' || tool.source === 'skill',
    );
  }

  get size(): number {
    return this.tools.size;
  }

  clear(): void {
    this.tools.clear();
  }
}

export const toolRegistry = new ToolRegistry();

export function registerTool(
  registration: ToolRegistration,
  source: ToolSource = 'plugin',
  pluginId?: string,
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
