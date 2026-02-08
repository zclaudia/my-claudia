import { Router, Request, Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { ApiResponse, CommandExecuteRequest, CommandExecuteResponse, SlashCommand } from '@my-claudia/shared';
import { LOCAL_COMMANDS } from '@my-claudia/shared';

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

// Built-in command handlers
const builtInHandlers: Record<string, (args: string[], context: CommandExecuteRequest['context']) => CommandExecuteResponse> = {
  '/clear': (_args, _context) => ({
    type: 'builtin',
    command: '/clear',
    action: 'clear',
    data: {
      message: 'Conversation history cleared'
    }
  }),

  '/help': (_args, _context) => {
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
  },

  '/status': (_args, context) => {
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
  },

  '/model': (_args, context) => {
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
  },

  '/cost': (_args, context) => {
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
  },

  '/memory': (_args, context) => {
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
  },

  '/config': (_args, _context) => ({
    type: 'builtin',
    command: '/config',
    action: 'config',
    data: {
      message: 'Opening settings...'
    }
  }),

  '/new-session': (_args, _context) => ({
    type: 'builtin',
    command: '/new-session',
    action: 'new-session',
    data: {
      message: 'Creating new session...'
    }
  })
};

// Scan directory for custom command files (.md)
async function scanCommandsDirectory(dir: string, namespace: 'project' | 'user'): Promise<SlashCommand[]> {
  const commands: SlashCommand[] = [];

  try {
    if (!fs.existsSync(dir)) {
      return commands;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Recursively scan subdirectories
        const subCommands = await scanCommandsDirectory(fullPath, namespace);
        commands.push(...subCommands);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        // Parse markdown file
        try {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const relativePath = path.relative(dir, fullPath);
          const commandName = '/' + relativePath.replace(/\.md$/, '').replace(/\\/g, '/');

          // Extract description from first line
          const firstLine = content.trim().split('\n')[0];
          const description = firstLine.replace(/^#+\s*/, '').trim();

          commands.push({
            command: commandName,
            description,
            source: 'custom',
            scope: namespace === 'project' ? 'project' : 'global',
            filePath: fullPath
          });
        } catch (err) {
          console.error(`Error parsing command file ${fullPath}:`, err);
        }
      }
    }
  } catch (err) {
    console.error(`Error scanning directory ${dir}:`, err);
  }

  return commands;
}

export function createCommandsRoutes(): Router {
  const router = Router();

  // POST /api/commands/list - List all available commands
  router.post('/list', async (req: Request, res: Response) => {
    try {
      const { projectPath } = req.body as { projectPath?: string };
      const customCommands: SlashCommand[] = [];

      // Scan project-level commands
      if (projectPath) {
        const projectCommandsDir = path.join(projectPath, '.claude', 'commands');
        const projectCommands = await scanCommandsDirectory(projectCommandsDir, 'project');
        customCommands.push(...projectCommands);
      }

      // Scan user-level commands
      const userCommandsDir = path.join(os.homedir(), '.claude', 'commands');
      const userCommands = await scanCommandsDirectory(userCommandsDir, 'user');
      customCommands.push(...userCommands);

      res.json({
        success: true,
        data: {
          builtin: LOCAL_COMMANDS,
          custom: customCommands,
          count: LOCAL_COMMANDS.length + customCommands.length
        }
      } as ApiResponse<{ builtin: SlashCommand[]; custom: SlashCommand[]; count: number }>);
    } catch (error) {
      console.error('Error listing commands:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to list commands' }
      });
    }
  });

  // POST /api/commands/execute - Execute a command
  router.post('/execute', async (req: Request, res: Response) => {
    try {
      const { commandName, commandPath, args = [], context = {} } = req.body as CommandExecuteRequest;

      if (!commandName) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'commandName is required' }
        });
        return;
      }

      // Handle built-in commands
      const handler = builtInHandlers[commandName];
      if (handler) {
        const result = handler(args, context);
        res.json({ success: true, data: result } as ApiResponse<CommandExecuteResponse>);
        return;
      }

      // Handle custom commands
      if (!commandPath) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'commandPath is required for custom commands' }
        });
        return;
      }

      // Security: validate commandPath is within allowed directories
      const resolvedPath = path.resolve(commandPath);
      const userBase = path.resolve(path.join(os.homedir(), '.claude', 'commands'));
      const projectBase = context?.projectPath
        ? path.resolve(path.join(context.projectPath, '.claude', 'commands'))
        : null;

      const isUnderBase = (base: string) => {
        const rel = path.relative(base, resolvedPath);
        return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
      };

      if (!(isUnderBase(userBase) || (projectBase && isUnderBase(projectBase)))) {
        res.status(403).json({
          success: false,
          error: { code: 'FORBIDDEN', message: 'Command must be in .claude/commands directory' }
        });
        return;
      }

      // Read and process command file
      if (!fs.existsSync(commandPath)) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: `Command file not found: ${commandPath}` }
        });
        return;
      }

      const content = fs.readFileSync(commandPath, 'utf-8');

      // Basic argument replacement
      let processedContent = content;

      // Replace $ARGUMENTS with all arguments joined
      const argsString = args.join(' ');
      processedContent = processedContent.replace(/\$ARGUMENTS/g, argsString);

      // Replace $1, $2, etc. with positional arguments
      args.forEach((arg, index) => {
        const placeholder = `$${index + 1}`;
        processedContent = processedContent.replace(new RegExp(`\\${placeholder}\\b`, 'g'), arg);
      });

      const result: CommandExecuteResponse = {
        type: 'custom',
        command: commandName,
        content: processedContent
      };

      res.json({ success: true, data: result } as ApiResponse<CommandExecuteResponse>);
    } catch (error) {
      console.error('Error executing command:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to execute command' }
      });
    }
  });

  return router;
}
