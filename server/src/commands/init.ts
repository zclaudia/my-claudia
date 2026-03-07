/**
 * Built-in Commands Registration
 *
 * This file registers all built-in slash commands into the CommandRegistry.
 */

import * as path from 'path';
import * as fs from 'fs';
import type { CommandExecuteResponse, CommandExecuteRequest } from '@my-claudia/shared';
import { LOCAL_COMMANDS } from '@my-claudia/shared';
import { commandRegistry } from './registry.js';
import { clearCommandCache } from '../providers/claude-sdk.js';

// ============================================
// Helper Functions
// ============================================

// Read package.json for version info
function getPackageInfo(): { name: string; version: string } {
  try {
    const packageJsonPath = path.join(__dirname, '..', '..', '..', 'package.json');
    const content = fs.readFileSync(packageJsonPath, 'utf-8');
    const pkg = JSON.parse(content);
    return { name: pkg.name || 'my-claudia', version: pkg.version || 'unknown' };
  } catch {
    return { name: 'my-claudia', version: 'unknown' };
  }
}

// Format uptime
function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// ============================================
// Command Handlers
// ============================================

type CommandContext = CommandExecuteRequest['context'];

const clearHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => ({
  type: 'builtin',
  command: '/clear',
  action: 'clear',
  data: {
    message: 'Conversation history cleared'
  }
});

const helpHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => {
  const helpText = `**Built-in Commands:**

${LOCAL_COMMANDS.map(cmd => `- \`${cmd.command}\` — ${cmd.description}`).join('\n')}

**Custom Commands:**

- Project: \`.claude/commands/\` (project-specific)
- User: \`~/.claude/commands/\` (available in all projects)
- Use \`$ARGUMENTS\` or \`$1\`, \`$2\` for args, \`@filename\` for file includes
`;

  return {
    type: 'builtin',
    command: '/help',
    action: 'help',
    data: {
      content: helpText,
      format: 'markdown'
    }
  };
};

const statusHandler = (_args: string[], context?: CommandContext): CommandExecuteResponse => {
  const pkg = getPackageInfo();
  const uptime = process.uptime();

  return {
    type: 'builtin',
    command: '/status',
    action: 'status',
    data: {
      version: pkg.version,
      packageName: pkg.name,
      uptime: formatUptime(uptime),
      uptimeSeconds: Math.floor(uptime),
      model: context?.model || 'unknown',
      provider: context?.provider || 'claude',
      nodeVersion: process.version,
      platform: process.platform,
      projectPath: context?.projectPath || 'N/A'
    }
  };
};

const modelHandler = (_args: string[], context?: CommandContext): CommandExecuteResponse => {
  const model = context?.model || 'default';
  const provider = context?.provider || 'claude';
  let message = '**Model Info:**\n\n';
  message += `- **Model:** ${model}\n`;
  message += `- **Provider:** ${provider}\n`;

  return {
    type: 'builtin',
    command: '/model',
    action: 'model',
    data: { model, provider, message }
  };
};

const costHandler = (_args: string[], context?: CommandContext): CommandExecuteResponse => {
  const tokenUsage = context?.tokenUsage || { used: 0, total: 160000 };
  const percentage = tokenUsage.total > 0
    ? ((tokenUsage.used / tokenUsage.total) * 100).toFixed(1)
    : '0';

  return {
    type: 'builtin',
    command: '/cost',
    action: 'cost',
    data: {
      tokenUsage: {
        used: tokenUsage.used,
        total: tokenUsage.total,
        percentage
      },
      model: context?.model || 'unknown'
    }
  };
};

const memoryHandler = (_args: string[], context?: CommandContext): CommandExecuteResponse => {
  const projectPath = context?.projectPath;

  if (!projectPath) {
    return {
      type: 'builtin',
      command: '/memory',
      action: 'memory',
      data: {
        error: true,
        message: 'No project selected. Please select a project to access its CLAUDE.md file.'
      }
    };
  }

  const claudeMdPath = path.join(projectPath, 'CLAUDE.md');
  const exists = fs.existsSync(claudeMdPath);

  return {
    type: 'builtin',
    command: '/memory',
    action: 'memory',
    data: {
      path: claudeMdPath,
      exists,
      message: exists
        ? `CLAUDE.md found at ${claudeMdPath}`
        : `CLAUDE.md not found at ${claudeMdPath}. Create it to store project-specific instructions.`
    }
  };
};

const configHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => ({
  type: 'builtin',
  command: '/config',
  action: 'config',
  data: {
    message: 'Opening settings...'
  }
});

const newSessionHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => ({
  type: 'builtin',
  command: '/new-session',
  action: 'new-session',
  data: {
    message: 'Creating new session...'
  }
});

const reloadHandler = (_args: string[], _context?: CommandContext): CommandExecuteResponse => {
  clearCommandCache();
  return {
    type: 'builtin',
    command: '/reload',
    action: 'reload',
    data: {
      message: 'Commands reloaded'
    }
  };
};

// ============================================
// Register Built-in Commands
// ============================================

export function registerBuiltinCommands(): void {
  const commands = [
    { command: '/clear', description: 'Clear conversation history', handler: clearHandler },
    { command: '/help', description: 'Show available commands', handler: helpHandler },
    { command: '/status', description: 'Show server status', handler: statusHandler },
    { command: '/model', description: 'Show current model info', handler: modelHandler },
    { command: '/cost', description: 'Show token usage', handler: costHandler },
    { command: '/memory', description: 'Show CLAUDE.md file info', handler: memoryHandler },
    { command: '/config', description: 'Open settings', handler: configHandler },
    { command: '/new-session', description: 'Create a new session', handler: newSessionHandler },
    { command: '/reload', description: 'Reload custom commands', handler: reloadHandler },
  ];

  for (const cmd of commands) {
    commandRegistry.register({
      command: cmd.command,
      description: cmd.description,
      handler: cmd.handler,
      source: 'builtin',
    });
  }

  console.log(`[CommandRegistry] Registered ${commandRegistry.size} built-in commands`);
}

// Auto-register on import
let registered = false;

export function ensureBuiltinCommandsRegistered(): void {
  if (!registered) {
    registerBuiltinCommands();
    registered = true;
  }
}
