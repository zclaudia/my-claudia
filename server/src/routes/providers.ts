import { Router, Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import fs from 'fs';
import path from 'path';
import os from 'os';
import type Database from 'better-sqlite3';
import type { ProviderConfig, ApiResponse, SlashCommand, ProviderCapabilities, ModeOption, ModelOption } from '@my-claudia/shared';
import { LOCAL_COMMANDS, CLI_COMMANDS, CLAUDE_FALLBACK_COMMANDS } from '@my-claudia/shared';
import { scanCustomCommands } from '../utils/command-scanner.js';
import { openCodeServerManager } from '../providers/opencode-sdk.js';
import { fetchClaudeModels, fetchClaudeCommands } from '../providers/claude-sdk.js';

// Database row type (different from ProviderConfig due to SQLite types)
interface ProviderRow {
  id: string;
  name: string;
  type: string;
  cliPath: string | null;
  env: string | null;
  isDefault: number;
  createdAt: number;
  updatedAt: number;
}

export function createProviderRoutes(db: Database.Database): Router {
  const router = Router();

  // Get all providers
  router.get('/', (_req: Request, res: Response) => {
    try {
      const providers = db.prepare(`
        SELECT id, name, type, cli_path as cliPath, env,
               is_default as isDefault, created_at as createdAt, updated_at as updatedAt
        FROM providers
        ORDER BY is_default DESC, name ASC
      `).all() as ProviderRow[];

      const result: ProviderConfig[] = providers.map(p => ({
        id: p.id,
        name: p.name,
        type: p.type as ProviderConfig['type'],
        cliPath: p.cliPath || undefined,
        env: p.env ? JSON.parse(p.env) : undefined,
        isDefault: p.isDefault === 1,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt
      }));

      res.json({ success: true, data: result } as ApiResponse<ProviderConfig[]>);
    } catch (error) {
      console.error('Error fetching providers:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch providers' }
      });
    }
  });

  // Get single provider
  router.get('/:id', (req: Request, res: Response) => {
    try {
      const row = db.prepare(`
        SELECT id, name, type, cli_path as cliPath, env,
               is_default as isDefault, created_at as createdAt, updated_at as updatedAt
        FROM providers WHERE id = ?
      `).get(req.params.id) as ProviderRow | undefined;

      if (!row) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      const provider: ProviderConfig = {
        id: row.id,
        name: row.name,
        type: row.type as ProviderConfig['type'],
        cliPath: row.cliPath || undefined,
        env: row.env ? JSON.parse(row.env) : undefined,
        isDefault: row.isDefault === 1,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt
      };

      res.json({
        success: true,
        data: provider
      } as ApiResponse<ProviderConfig>);
    } catch (error) {
      console.error('Error fetching provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to fetch provider' }
      });
    }
  });

  // Create provider
  router.post('/', (req: Request, res: Response) => {
    try {
      const { name, type = 'claude', cliPath, env, isDefault } = req.body;

      if (!name) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: 'Name is required' }
        });
        return;
      }

      const VALID_PROVIDER_TYPES = ['claude', 'opencode'];
      if (type && !VALID_PROVIDER_TYPES.includes(type)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` }
        });
        return;
      }

      const id = uuidv4();
      const now = Date.now();

      // If this provider is default, unset other defaults
      if (isDefault) {
        db.prepare('UPDATE providers SET is_default = 0').run();
      }

      db.prepare(`
        INSERT INTO providers (id, name, type, cli_path, env, is_default, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        name,
        type,
        cliPath || null,
        env ? JSON.stringify(env) : null,
        isDefault ? 1 : 0,
        now,
        now
      );

      const provider: ProviderConfig = {
        id,
        name,
        type,
        cliPath,
        env,
        isDefault: isDefault || false,
        createdAt: now,
        updatedAt: now
      };

      res.status(201).json({ success: true, data: provider } as ApiResponse<ProviderConfig>);
    } catch (error) {
      console.error('Error creating provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to create provider' }
      });
    }
  });

  // Update provider
  router.put('/:id', (req: Request, res: Response) => {
    try {
      const { name, type, cliPath, env, isDefault } = req.body;
      const now = Date.now();

      const VALID_PROVIDER_TYPES = ['claude', 'opencode'];
      if (type && !VALID_PROVIDER_TYPES.includes(type)) {
        res.status(400).json({
          success: false,
          error: { code: 'VALIDATION_ERROR', message: `Invalid provider type. Must be one of: ${VALID_PROVIDER_TYPES.join(', ')}` }
        });
        return;
      }

      // If this provider is becoming default, unset other defaults
      if (isDefault) {
        db.prepare('UPDATE providers SET is_default = 0 WHERE id != ?').run(req.params.id);
      }

      const result = db.prepare(`
        UPDATE providers
        SET name = COALESCE(?, name),
            type = COALESCE(?, type),
            cli_path = ?,
            env = ?,
            is_default = COALESCE(?, is_default),
            updated_at = ?
        WHERE id = ?
      `).run(
        name || null,
        type || null,
        cliPath !== undefined ? cliPath : null,
        env ? JSON.stringify(env) : null,
        isDefault !== undefined ? (isDefault ? 1 : 0) : null,
        now,
        req.params.id
      );

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error updating provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to update provider' }
      });
    }
  });

  // Delete provider
  router.delete('/:id', (req: Request, res: Response) => {
    try {
      const result = db.prepare('DELETE FROM providers WHERE id = ?').run(req.params.id);

      if (result.changes === 0) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error deleting provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to delete provider' }
      });
    }
  });

  // Get commands for a provider
  // Query params: ?projectRoot=<path> - optional, to include project-level custom commands
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

      // Deduplicate: provider commands take priority over custom commands with same name
      const providerCommandNames = new Set(providerCommands.map(c => c.command));
      const dedupedCustom = customCommands.filter(c => !providerCommandNames.has(c.command));

      const allCommands: SlashCommand[] = [
        ...LOCAL_COMMANDS,
        ...CLI_COMMANDS,
        ...providerCommands,
        ...dedupedCustom
      ];

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
  // Query params: ?projectRoot=<path> - optional, to include project-level custom commands
  router.get('/type/:type/commands', async (req: Request, res: Response) => {
    try {
      const projectRoot = req.query.projectRoot as string | undefined;
      const customCommands = scanCustomCommands({ projectRoot });
      const providerCommands = await getProviderCommands(req.params.type);

      // Deduplicate: provider commands take priority over custom commands with same name
      const providerCommandNames = new Set(providerCommands.map(c => c.command));
      const dedupedCustom = customCommands.filter(c => !providerCommandNames.has(c.command));

      const allCommands: SlashCommand[] = [
        ...LOCAL_COMMANDS,
        ...CLI_COMMANDS,
        ...providerCommands,
        ...dedupedCustom
      ];

      res.json({ success: true, data: allCommands } as ApiResponse<SlashCommand[]>);
    } catch (error) {
      console.error('Error fetching provider type commands:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch provider type commands' }
      });
    }
  });

  // Set provider as default
  router.post('/:id/set-default', (req: Request, res: Response) => {
    try {
      // Verify provider exists
      const provider = db.prepare('SELECT id FROM providers WHERE id = ?').get(req.params.id);
      if (!provider) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      const now = Date.now();

      // Unset all defaults
      db.prepare('UPDATE providers SET is_default = 0, updated_at = ?').run(now);

      // Set this provider as default
      db.prepare('UPDATE providers SET is_default = 1, updated_at = ? WHERE id = ?').run(
        now,
        req.params.id
      );

      res.json({ success: true } as ApiResponse<void>);
    } catch (error) {
      console.error('Error setting default provider:', error);
      res.status(500).json({
        success: false,
        error: { code: 'DB_ERROR', message: 'Failed to set default provider' }
      });
    }
  });

  // Get capabilities by provider type (fallback when no provider ID is configured)
  router.get('/type/:type/capabilities', async (req: Request, res: Response) => {
    try {
      const capabilities = await getProviderCapabilities(req.params.type);
      res.json({ success: true, data: capabilities } as ApiResponse<ProviderCapabilities>);
    } catch (error) {
      console.error('Error fetching provider type capabilities:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch provider capabilities' }
      });
    }
  });

  // Get provider capabilities (modes + models)
  // Returns what UI selectors should display — fully provider-agnostic
  router.get('/:id/capabilities', async (req: Request, res: Response) => {
    try {
      const row = db.prepare(`
        SELECT id, name, type, cli_path as cliPath, env
        FROM providers WHERE id = ?
      `).get(req.params.id) as { id: string; name: string; type: string; cliPath: string | null; env: string | null } | undefined;

      if (!row) {
        res.status(404).json({
          success: false,
          error: { code: 'NOT_FOUND', message: 'Provider not found' }
        });
        return;
      }

      const capabilities = await getProviderCapabilities(
        row.type,
        row.cliPath || undefined,
        row.env ? JSON.parse(row.env) : undefined
      );

      res.json({ success: true, data: capabilities } as ApiResponse<ProviderCapabilities>);
    } catch (error) {
      console.error('Error fetching provider capabilities:', error);
      res.status(500).json({
        success: false,
        error: { code: 'SERVER_ERROR', message: 'Failed to fetch provider capabilities' }
      });
    }
  });

  return router;
}

// ============================================
// Provider Capabilities Helpers
// ============================================

async function getClaudeCapabilities(
  cliPath?: string,
  env?: Record<string, string>
): Promise<ProviderCapabilities> {
  const fallbackModels: ModelOption[] = [
    { id: '', label: 'Default' },
    { id: 'claude-opus-4-6', label: 'Opus 4.6' },
    { id: 'claude-sonnet-4-5-20250929', label: 'Sonnet 4.5' },
    { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  ];

  let models: ModelOption[] = fallbackModels;

  try {
    const modelInfos = await fetchClaudeModels(cliPath, env);
    if (modelInfos.length > 0) {
      models = [
        { id: '', label: 'Default' },
        ...modelInfos.map(m => ({
          id: m.value,
          label: m.description || m.displayName,
        })),
      ];
    }
  } catch (error) {
    console.error('[Capabilities] Failed to fetch Claude models, using fallback:', error);
  }

  return {
    modeLabel: 'Mode',
    defaultModeId: 'default',
    modes: [
      { id: 'default', label: 'Default', icon: '🛡️', description: 'Standard mode - requires confirmation for tool calls' },
      { id: 'plan', label: 'Plan', icon: '📋', description: 'Planning mode - creates a plan before executing' },
      { id: 'acceptEdits', label: 'Auto-Edit', icon: '✏️', description: 'Auto-approve file edits only' },
      { id: 'bypassPermissions', label: 'Bypass', icon: '⚡', description: 'Skip all permission checks (use with caution)' },
    ],
    models,
  };
}

/** Read opencode.json config to find configured providers and their models */
function readOpenCodeConfig(): { providerIds: string[]; configModels: Map<string, Array<{ id: string; name: string }>> } | null {
  try {
    const configDir = process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), '.config', 'opencode');
    const configPath = path.join(configDir, 'opencode.json');

    if (!fs.existsSync(configPath)) return null;

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const providerSection = config.provider;
    if (!providerSection || typeof providerSection !== 'object') return null;

    const providerIds = Object.keys(providerSection);
    const configModels = new Map<string, Array<{ id: string; name: string }>>();

    for (const [providerId, providerDef] of Object.entries(providerSection)) {
      const def = providerDef as { name?: string; models?: Record<string, { name?: string }> };
      if (def.models && typeof def.models === 'object') {
        configModels.set(providerId, Object.entries(def.models).map(([modelId, modelDef]) => ({
          id: modelId,
          name: modelDef.name || modelId,
        })));
      }
    }

    return { providerIds, configModels };
  } catch (error) {
    console.error('[Capabilities] Failed to read opencode config:', error);
    return null;
  }
}

async function getOpenCodeCapabilities(
  cliPath?: string,
  env?: Record<string, string>
): Promise<ProviderCapabilities> {
  // Default fallback in case OpenCode server isn't available
  const fallback: ProviderCapabilities = {
    modeLabel: 'Agent',
    defaultModeId: 'sisyphus',
    modes: [
      { id: 'sisyphus', label: 'Sisyphus', description: 'Default coding agent' },
      { id: 'prometheus', label: 'Prometheus', description: 'Plan builder agent' },
      { id: 'hephaestus', label: 'Hephaestus', description: 'Deep agent' },
      { id: 'atlas', label: 'Atlas', description: 'Plan executor agent' },
    ],
    models: [{ id: '', label: 'Default' }],
  };

  // Read opencode.json to know which providers are truly configured
  const openCodeConfig = readOpenCodeConfig();
  const configuredProviderIds = openCodeConfig?.providerIds || [];

  try {
    // Use a temporary cwd for capabilities query
    const cwd = process.cwd();
    const server = await openCodeServerManager.ensureServer(cwd, { cliPath, env });
    const baseUrl = server.baseUrl;

    // Fetch agents and providers in parallel via SDK
    const [agentsResult, providerResp] = await Promise.all([
      server.client.app.agents({}).catch(() => null),
      fetch(`${baseUrl}/provider`).catch(() => null),
    ]);

    // Parse agents — OpenCode classifies agents as:
    //   'all'       = user-facing, can also be used as sub-agent
    //   'primary'   = user-facing primary agent
    //   'subagent'  = internal sub-agents only (not user-selectable)
    const modes: ModeOption[] = [];
    const agents = (agentsResult?.data || []) as Array<{ name: string; description?: string; mode: string }>;
    for (const agent of agents) {
      if (agent.mode !== 'subagent') {
        modes.push({
          id: agent.name,
          label: agent.name.charAt(0).toUpperCase() + agent.name.slice(1),
          description: agent.description || `${agent.name} agent`,
        });
      }
    }

    // Build models from config + serve API
    const models: ModelOption[] = [{ id: '', label: 'Default' }];

    // Track which configured providers we've already handled via config models
    const handledProviders = new Set<string>();

    // First: add models explicitly defined in opencode.json config
    if (openCodeConfig?.configModels) {
      for (const [providerId, configModelList] of openCodeConfig.configModels) {
        // Look up provider display name from serve API if available
        let providerName = providerId;
        if (providerResp?.ok) {
          // We'll parse the API data below, for now just use providerId
        }
        for (const model of configModelList) {
          models.push({
            id: `${providerId}/${model.id}`,
            label: model.name,
            group: providerName,
          });
        }
        handledProviders.add(providerId);
      }
    }

    // Second: for configured providers WITHOUT explicit models in config,
    // use models from the serve API (filtered to only configured providers)
    if (providerResp?.ok) {
      const data = await providerResp.json() as {
        all: Array<{ id: string; name: string; models: Record<string, { id: string; name: string; providerID: string }> }>;
        connected: string[];
        default: Record<string, string>;
      };

      const connectedIds = new Set(data.connected || []);

      for (const provider of data.all) {
        // Include providers that are either configured in opencode.json OR connected (e.g. via opencode auth login)
        if (!configuredProviderIds.includes(provider.id) && !connectedIds.has(provider.id)) continue;
        // Skip providers already handled via config models
        if (handledProviders.has(provider.id)) {
          // But update the group name if serve API has a better display name
          if (provider.name) {
            for (const m of models) {
              if (m.group === provider.id) {
                m.group = provider.name;
              }
            }
          }
          continue;
        }

        const groupName = provider.name || provider.id;
        for (const model of Object.values(provider.models)) {
          models.push({
            id: `${provider.id}/${model.id}`,
            label: model.name || model.id,
            group: groupName,
          });
        }
      }
    }

    return {
      modeLabel: 'Agent',
      defaultModeId: modes[0]?.id || 'build',
      modes: modes.length > 0 ? modes : fallback.modes,
      models: models.length > 1 ? models : fallback.models,
    };
  } catch (error) {
    console.error('[Capabilities] Failed to fetch OpenCode capabilities:', error);

    // Even if the serve API fails, we can still return models from config
    if (openCodeConfig?.configModels && openCodeConfig.configModels.size > 0) {
      const models: ModelOption[] = [{ id: '', label: 'Default' }];
      for (const [providerId, configModelList] of openCodeConfig.configModels) {
        for (const model of configModelList) {
          models.push({
            id: `${providerId}/${model.id}`,
            label: model.name,
            group: providerId,
          });
        }
      }
      return { ...fallback, models };
    }

    return fallback;
  }
}

async function getProviderCapabilities(
  providerType: string,
  cliPath?: string,
  env?: Record<string, string>
): Promise<ProviderCapabilities> {
  switch (providerType) {
    case 'opencode':
      return getOpenCodeCapabilities(cliPath, env);
    case 'claude':
    default:
      return getClaudeCapabilities(cliPath, env);
  }
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
      // Map OpenCode source to SlashCommand source
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
    case 'claude':
      return getClaudeCommands(cliPath, env);
    default:
      return [];
  }
}
