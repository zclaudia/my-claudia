/**
 * Command Registry - Centralized command registration and execution.
 *
 * This registry enables dynamic registration of slash commands for both built-in
 * and plugin-provided functionality. It follows the same pattern as ToolRegistry.
 *
 * Usage:
 *   // Register a command
 *   commandRegistry.register({
 *     command: '/my-command',
 *     description: 'My custom command',
 *     handler: async (args, context) => ({ type: 'builtin', command: '/my-command', data: {} }),
 *     source: 'plugin',
 *     pluginId: 'com.example.my-plugin',
 *   });
 *
 *   // Get all commands for UI display
 *   const commands = commandRegistry.getAllCommands();
 *
 *   // Execute a command
 *   const result = await commandRegistry.execute(commandName, args, context);
 */

import type { SlashCommand, CommandExecuteResponse } from '@my-claudia/shared';

// ============================================
// Types
// ============================================

export type CommandSource = 'builtin' | 'plugin';

export interface CommandContext {
  projectPath?: string;
  projectName?: string;
  sessionId?: string;
  provider?: string;
  model?: string;
  tokenUsage?: { used: number; total: number };
}

export type CommandHandler = (
  args: string[],
  context?: CommandContext
) => CommandExecuteResponse | Promise<CommandExecuteResponse>;

export interface CommandMeta {
  /** Command string (e.g., '/my-command') */
  command: string;
  /** Description displayed in autocomplete */
  description: string;
  /** Handler function for command execution */
  handler: CommandHandler;
  /** Source of the command */
  source: CommandSource;
  /** Plugin ID if source is 'plugin' */
  pluginId?: string;
  /** Required permissions (for plugins) */
  permissions?: string[];
}

// ============================================
// Command Registry
// ============================================

class CommandRegistry {
  private commands = new Map<string, CommandMeta>();

  /**
   * Register a command.
   * If a command with the same name exists, it will be overwritten with a warning.
   */
  register(meta: CommandMeta): void {
    if (this.commands.has(meta.command)) {
      const existing = this.commands.get(meta.command)!;
      console.warn(
        `[CommandRegistry] Command "${meta.command}" already registered by ${existing.source}` +
          (existing.pluginId ? ` (${existing.pluginId})` : '') +
          `. Overwriting with ${meta.source}` +
          (meta.pluginId ? ` (${meta.pluginId})` : '')
      );
    }
    this.commands.set(meta.command, meta);
  }

  /**
   * Unregister a command by name.
   * @returns true if the command was removed, false if it didn't exist
   */
  unregister(command: string): boolean {
    return this.commands.delete(command);
  }

  /**
   * Get a command's metadata by name.
   */
  get(command: string): CommandMeta | undefined {
    return this.commands.get(command);
  }

  /**
   * Check if a command exists.
   */
  has(command: string): boolean {
    return this.commands.has(command);
  }

  /**
   * Get all registered commands as SlashCommand array for UI display.
   */
  getAllCommands(): SlashCommand[] {
    return Array.from(this.commands.values()).map((cmd) => ({
      command: cmd.command,
      description: cmd.description,
      source: cmd.source === 'builtin' ? 'provider' : ('plugin' as const),
    }));
  }

  /**
   * Get commands filtered by source.
   */
  getCommandsBySource(source: CommandSource): SlashCommand[] {
    return Array.from(this.commands.values())
      .filter((cmd) => cmd.source === source)
      .map((cmd) => ({
        command: cmd.command,
        description: cmd.description,
        source: cmd.source === 'builtin' ? 'provider' : ('plugin' as const),
      }));
  }

  /**
   * Get all command metadata.
   */
  getAll(): CommandMeta[] {
    return Array.from(this.commands.values());
  }

  /**
   * Execute a command by name.
   * @param commandName - The command to execute (e.g., '/my-command')
   * @param args - Arguments passed to the command
   * @param context - Execution context
   * @returns The command execution response
   */
  async execute(
    commandName: string,
    args: string[] = [],
    context?: CommandContext
  ): Promise<CommandExecuteResponse> {
    const command = this.commands.get(commandName);

    if (!command) {
      return {
        type: 'builtin',
        command: commandName,
        error: `Unknown command: ${commandName}`,
      };
    }

    try {
      const result = await command.handler(args, context);
      return result;
    } catch (error) {
      return {
        type: 'builtin',
        command: commandName,
        error: `Command execution failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get all commands registered by a specific plugin.
   */
  getByPlugin(pluginId: string): CommandMeta[] {
    return Array.from(this.commands.values()).filter((cmd) => cmd.pluginId === pluginId);
  }

  /**
   * Clear all commands registered by a specific plugin.
   * Called when a plugin is deactivated or uninstalled.
   */
  clearByPlugin(pluginId: string): number {
    let count = 0;
    for (const [command, meta] of this.commands) {
      if (meta.pluginId === pluginId) {
        this.commands.delete(command);
        count++;
      }
    }
    return count;
  }

  /**
   * Get the number of registered commands.
   */
  get size(): number {
    return this.commands.size;
  }

  /**
   * Clear all registered commands (mainly for testing).
   */
  clear(): void {
    this.commands.clear();
  }
}

// ============================================
// Singleton Export
// ============================================

export const commandRegistry = new CommandRegistry();

// ============================================
// Convenience Registration Helper
// ============================================

/**
 * Register a command with a simpler API (useful for plugins).
 */
export function registerCommand(
  registration: {
    command: string;
    description: string;
    handler: CommandHandler;
    permissions?: string[];
  },
  source: CommandSource = 'plugin',
  pluginId?: string
): void {
  commandRegistry.register({
    command: registration.command,
    description: registration.description,
    handler: registration.handler,
    permissions: registration.permissions,
    source,
    pluginId,
  });
}
