import { Router, Request, Response } from 'express';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type { SlashCommand } from '@my-claudia/shared/features/commands';
import { LOCAL_COMMANDS, CLI_COMMANDS, CLAUDE_FALLBACK_COMMANDS } from '@my-claudia/shared/features/commands';
import { scanCustomCommands } from '../../utils/command-scanner.js';
import { openCodeServerManager } from '../../infrastructure/providers/opencode-sdk.js';
import { fetchClaudeCommands } from '../../infrastructure/providers/claude-sdk.js';
import { commandRegistry } from '../../application/commands/registry.js';

export function mountCommandRoutes(router: Router, db: Database.Database): void {
  // Get commands for a provider
  router.get('/:id/commands', async (req: Request, res: Response) => {
    try {
      const row = db.prepare('SELECT type, cli_path as cliPath, env FROM providers WHERE id = ?')
        .get(req.params.id) as { type: string; cliPath: string | null; env: string | null } | undefined;

      if (!row) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      const projectRoot = req.query.projectRoot as string | undefined;
      const customCommands = scanCustomCommands({ projectRoot });
      const providerCommands = await getProviderCommands(
        row.type,
        row.cliPath || undefined,
        row.env ? JSON.parse(row.env) : undefined
      );

      const providerCommandNames = new Set(providerCommands.map(c => c.command));
      const dedupedCustom = customCommands.filter(c => !providerCommandNames.has(c.command));

      const pluginCommands = commandRegistry.getCommandsBySource('plugin');

      const allCommands = deduplicateCommands([
        ...LOCAL_COMMANDS,
        ...CLI_COMMANDS,
        ...providerCommands,
        ...pluginCommands,
        ...dedupedCustom
      ]);

      res.json({ success: true, data: allCommands } as ApiResponse<SlashCommand[]>);
    } catch (error) {
      console.error('Error fetching provider commands:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch provider commands' }
      });
    }
  });

  // Get commands for a provider type (without needing a provider ID)
  router.get('/type/:type/commands', async (req: Request, res: Response) => {
    try {
      const projectRoot = req.query.projectRoot as string | undefined;
      const customCommands = scanCustomCommands({ projectRoot });
      const providerCommands = await getProviderCommands(req.params.type);

      const providerCommandNames = new Set(providerCommands.map(c => c.command));
      const dedupedCustom = customCommands.filter(c => !providerCommandNames.has(c.command));

      const pluginCommands = commandRegistry.getCommandsBySource('plugin');

      const allCommands = deduplicateCommands([
        ...LOCAL_COMMANDS,
        ...CLI_COMMANDS,
        ...providerCommands,
        ...pluginCommands,
        ...dedupedCustom
      ]);

      res.json({ success: true, data: allCommands } as ApiResponse<SlashCommand[]>);
    } catch (error) {
      console.error('Error fetching provider type commands:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch provider type commands' }
      });
    }
  });
}

// ============================================
// Provider Commands Helpers
// ============================================

async function getOpenCodeCommands(
  cliPath?: string,
  env?: Record<string, string>
): Promise<SlashCommand[]> {
  try {
    const cwd = process.cwd();
    const server = await openCodeServerManager.ensureServer(cwd, { cliPath, env });
    const resp = await fetch(`${server.baseUrl}/command`).catch(() => null);
    if (!resp?.ok) return [];

    const commands = await resp.json() as Array<{
      name: string;
      description: string;
      source: string;
    }>;

    return commands.map(cmd => {
      let source: SlashCommand['source'] = 'provider';
      if (cmd.source === 'mcp') source = 'plugin';

      return {
        command: `/${cmd.name}`,
        description: cmd.description,
        source,
      };
    });
  } catch (error) {
    console.error('[Commands] Failed to fetch OpenCode commands:', error);
    return [];
  }
}

function deduplicateCommands(commands: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>();
  return commands.filter(cmd => {
    if (seen.has(cmd.command)) return false;
    seen.add(cmd.command);
    return true;
  });
}

async function getClaudeCommands(
  cliPath?: string,
  env?: Record<string, string>
): Promise<SlashCommand[]> {
  try {
    const sdkCommands = await fetchClaudeCommands(cliPath, env);
    if (sdkCommands.length > 0) {
      return sdkCommands.map(cmd => ({
        command: cmd.name.startsWith('/') ? cmd.name : `/${cmd.name}`,
        description: cmd.description,
        source: 'provider' as const,
      }));
    }
  } catch (error) {
    console.error('[Commands] Failed to fetch Claude commands, using fallback:', error);
  }
  return CLAUDE_FALLBACK_COMMANDS;
}

async function getProviderCommands(
  providerType: string,
  cliPath?: string,
  env?: Record<string, string>
): Promise<SlashCommand[]> {
  switch (providerType) {
    case 'opencode':
      return getOpenCodeCommands(cliPath, env);
    case 'openclaude':
      return getClaudeCommands(cliPath || 'openclaude', {
        ...(env || {}),
        CLAUDE_CODE_USE_OPENAI: env?.CLAUDE_CODE_USE_OPENAI || '1',
      });
    case 'claude':
      return getClaudeCommands(cliPath, env);
    case 'codex':
    case 'cursor':
    case 'kimi':
    default:
      return [];
  }
}
