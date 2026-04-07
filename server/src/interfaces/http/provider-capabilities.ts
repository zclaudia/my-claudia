import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFile as execFileCb } from 'child_process';
import { promisify } from 'util';
import type Database from 'better-sqlite3';
import type { ApiResponse } from '@my-claudia/shared/core/api';
import type { ProviderCapabilities, ModeOption, ModelOption } from '@my-claudia/shared/core/provider';
import { openCodeServerManager } from '../../infrastructure/providers/opencode-sdk.js';
import { fetchClaudeModels } from '../../infrastructure/providers/claude-sdk.js';
import { supportsAIReviewCliJob } from '../../infrastructure/providers/cli-jobs/review-job.js';

const execFile = promisify(execFileCb);

export function mountCapabilityRoutes(router: Router, db: Database.Database): void {
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
      { id: 'default', label: 'Default', description: 'Standard mode - requires confirmation for tool calls' },
      { id: 'plan', label: 'Plan', description: 'Planning mode - creates a plan before executing' },
      { id: 'acceptEdits', label: 'Auto-Edit', description: 'Auto-approve file edits only' },
      { id: 'bypassPermissions', label: 'Bypass', description: 'Skip all permission checks (use with caution)' },
    ],
    models,
  };
}

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

  const openCodeConfig = readOpenCodeConfig();
  const configuredProviderIds = openCodeConfig?.providerIds || [];

  try {
    const cwd = process.cwd();
    const server = await openCodeServerManager.ensureServer(cwd, { cliPath, env });
    const baseUrl = server.baseUrl;

    const [agentsResult, providerResp] = await Promise.all([
      server.client.app.agents({}).catch(() => null),
      fetch(`${baseUrl}/provider`).catch(() => null),
    ]);

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

    const models: ModelOption[] = [{ id: '', label: 'Default' }];
    const handledProviders = new Set<string>();

    if (openCodeConfig?.configModels) {
      for (const [providerId, configModelList] of openCodeConfig.configModels) {
        const providerName = providerId;
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

    if (providerResp?.ok) {
      const data = await providerResp.json() as {
        all: Array<{ id: string; name: string; models: Record<string, { id: string; name: string; providerID: string }> }>;
        connected: string[];
        default: Record<string, string>;
      };

      const connectedIds = new Set(data.connected || []);

      for (const provider of data.all) {
        if (!configuredProviderIds.includes(provider.id) && !connectedIds.has(provider.id)) continue;
        if (handledProviders.has(provider.id)) {
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

const CODEX_FALLBACK_MODELS: ModelOption[] = [
  { id: '', label: 'Default' },
  { id: 'gpt-5.3-codex', label: 'gpt-5.3-codex' },
  { id: 'gpt-5.2-codex', label: 'gpt-5.2-codex' },
  { id: 'gpt-5.1-codex-max', label: 'gpt-5.1-codex-max' },
  { id: 'gpt-5.2', label: 'gpt-5.2' },
  { id: 'gpt-5.1-codex-mini', label: 'gpt-5.1-codex-mini' },
];

const CURSOR_FALLBACK_MODELS: ModelOption[] = [
  { id: '', label: 'Default' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  { id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
  { id: 'gpt-5', label: 'GPT-5' },
  { id: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { id: 'o3', label: 'o3' },
];

async function runCliForModels(
  binary: string,
  args: string[],
  env?: Record<string, string>
): Promise<string> {
  try {
    const { stdout, stderr } = await execFile(binary, args, {
      env: { ...process.env, ...(env || {}) },
      timeout: 3500,
      maxBuffer: 1024 * 1024,
      cwd: process.cwd(),
    });
    return `${stdout || ''}\n${stderr || ''}`;
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string };
    return `${err.stdout || ''}\n${err.stderr || ''}`;
  }
}

function isLikelyModelId(value: string): boolean {
  const v = value.trim();
  if (!v) return false;
  if (v.length < 2 || v.length > 80) return false;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(v)) return false;

  const lower = v.toLowerCase();
  if (/^(default|auto|latest)$/.test(lower)) return false;

  return /^(gpt|o[1-9]|claude|gemini|llama|mistral|qwen|deepseek)/.test(lower)
    || lower.includes('-codex')
    || lower.includes('sonnet')
    || lower.includes('opus')
    || lower.includes('haiku');
}

function parseModelIdsFromText(raw: string): string[] {
  const ids = new Set<string>();
  const text = raw || '';
  const tokenRegex = /\b[a-z0-9]+(?:[._-][a-z0-9]+)*\b/ig;
  const matches = text.match(tokenRegex) || [];
  for (const token of matches) {
    const candidate = token.trim();
    if (isLikelyModelId(candidate)) {
      ids.add(candidate);
    }
  }
  return [...ids];
}

function collectModelIdsFromJson(value: unknown, out: Set<string>): void {
  if (typeof value === 'string') {
    if (isLikelyModelId(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectModelIdsFromJson(item, out);
    return;
  }
  if (!value || typeof value !== 'object') return;

  const obj = value as Record<string, unknown>;
  const directKeys = ['id', 'slug', 'model', 'name', 'value'];
  for (const key of directKeys) {
    const maybe = obj[key];
    if (typeof maybe === 'string' && isLikelyModelId(maybe)) {
      out.add(maybe);
    }
  }

  for (const nested of Object.values(obj)) {
    collectModelIdsFromJson(nested, out);
  }
}

function parseModelIdsFromJson(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    const out = new Set<string>();
    collectModelIdsFromJson(parsed, out);
    return [...out];
  } catch {
    return [];
  }
}

function toModelOptions(ids: string[]): ModelOption[] {
  if (ids.length === 0) return [{ id: '', label: 'Default' }];
  const unique = [...new Set(ids)];
  unique.sort((a, b) => a.localeCompare(b, 'en'));
  return [{ id: '', label: 'Default' }, ...unique.map(id => ({ id, label: id }))];
}

function isCredibleModelSet(ids: string[], provider: 'codex' | 'cursor'): boolean {
  if (ids.length < 2) return false;
  const lower = ids.map(i => i.toLowerCase());
  if (provider === 'codex') {
    return lower.some(i => i.includes('codex')) || lower.some(i => i.startsWith('gpt-'));
  }
  return lower.some(i => i.startsWith('gpt-'))
    || lower.some(i => i.startsWith('claude-'))
    || lower.some(i => i === 'o3' || i.startsWith('o4'));
}

async function fetchCodexModels(cliPath?: string, env?: Record<string, string>): Promise<ModelOption[]> {
  try {
    const homeDir = env?.HOME || os.homedir();
    const cachePath = path.join(homeDir, '.codex', 'models_cache.json');
    if (fs.existsSync(cachePath)) {
      const raw = fs.readFileSync(cachePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        models?: Array<{ slug?: string; display_name?: string; visibility?: string }>;
      };
      if (Array.isArray(parsed.models) && parsed.models.length > 0) {
        const fromCache = parsed.models
          .filter(m => (m.visibility || 'list') !== 'hidden')
          .map(m => ({ id: m.slug || '', label: m.display_name || m.slug || '' }))
          .filter(m => m.id && m.label);
        if (fromCache.length > 0) {
          return [{ id: '', label: 'Default' }, ...fromCache];
        }
      }
    }
  } catch (error) {
    console.error('[Capabilities] Failed to read codex models cache:', error);
  }

  const binary = cliPath || 'codex';
  const outputs = await Promise.all([
    runCliForModels(binary, ['--help'], env),
    runCliForModels(binary, ['exec', '--help'], env),
  ]);
  const combined = outputs.join('\n');
  const jsonIds = parseModelIdsFromJson(combined);
  if (isCredibleModelSet(jsonIds, 'codex')) return toModelOptions(jsonIds);

  const textIds = parseModelIdsFromText(combined);
  if (isCredibleModelSet(textIds, 'codex')) return toModelOptions(textIds);

  return CODEX_FALLBACK_MODELS;
}

async function fetchCursorModels(cliPath?: string, env?: Record<string, string>): Promise<ModelOption[]> {
  const binary = cliPath || 'cursor-agent';
  const probes: string[][] = [
    ['models', '--json'],
    ['model', 'list', '--json'],
    ['--list-models', '--json'],
    ['models'],
    ['model', 'list'],
    ['--list-models'],
    ['--help'],
  ];

  for (const args of probes) {
    const output = await runCliForModels(binary, args, env);
    if (!output.trim()) continue;

    const jsonIds = parseModelIdsFromJson(output);
    if (isCredibleModelSet(jsonIds, 'cursor')) {
      return toModelOptions(jsonIds);
    }

    const textIds = parseModelIdsFromText(output);
    if (isCredibleModelSet(textIds, 'cursor')) {
      return toModelOptions(textIds);
    }
  }

  return CURSOR_FALLBACK_MODELS;
}

async function getCodexCapabilities(
  cliPath?: string,
  env?: Record<string, string>
): Promise<ProviderCapabilities> {
  const models = await fetchCodexModels(cliPath, env);
  return {
    modeLabel: 'Mode',
    defaultModeId: 'default',
    modes: [
      { id: 'default', label: 'Default', description: 'Standard mode — requests approval for tool calls' },
      { id: 'plan', label: 'Plan', description: 'Read-only planning mode' },
      { id: 'acceptEdits', label: 'Auto-Edit', description: 'Auto-approve file edits' },
      { id: 'bypassPermissions', label: 'Bypass', description: 'Full access, no approval checks' },
    ],
    models,
  };
}

async function getCursorCapabilities(
  cliPath?: string,
  env?: Record<string, string>
): Promise<ProviderCapabilities> {
  const models = await fetchCursorModels(cliPath, env);
  return {
    modeLabel: 'Mode',
    defaultModeId: 'default',
    modes: [
      { id: 'default', label: 'Agent', description: 'Full agent mode — reads, edits, and runs commands' },
      { id: 'plan', label: 'Plan', description: 'Planning mode — reads only, proposes changes' },
      { id: 'ask', label: 'Ask', description: 'Ask mode — answers questions without editing files' },
    ],
    models,
  };
}

async function getKimiCapabilities(): Promise<ProviderCapabilities> {
  return {
    modeLabel: 'Mode',
    defaultModeId: 'default',
    modes: [
      { id: 'default', label: 'Agent', description: 'Standard agent mode' },
      { id: 'plan', label: 'Plan', description: 'Planning mode with stricter permissions' },
      { id: 'ask', label: 'Ask', description: 'Q&A mode with minimal actions' },
    ],
    models: [{ id: '', label: 'Default' }],
  };
}

async function getProviderCapabilities(
  providerType: string,
  cliPath?: string,
  env?: Record<string, string>
): Promise<ProviderCapabilities> {
  let capabilities: ProviderCapabilities;
  switch (providerType) {
    case 'opencode':
      capabilities = await getOpenCodeCapabilities(cliPath, env);
      break;
    case 'codex':
      capabilities = await getCodexCapabilities(cliPath, env);
      break;
    case 'cursor':
      capabilities = await getCursorCapabilities(cliPath, env);
      break;
    case 'kimi':
      capabilities = await getKimiCapabilities();
      break;
    case 'claude':
    default:
      capabilities = await getClaudeCapabilities(cliPath, env);
      break;
  }

  return {
    ...capabilities,
    supportsCliJobs: supportsAIReviewCliJob(providerType),
  };
}
