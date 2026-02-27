import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Reads user's Claude CLI configuration (~/.claude/) and provides
 * MCP server configs and plugin configs for the Agent SDK.
 *
 * The Agent SDK subprocess doesn't automatically load these from the
 * user's config, so we read them and pass them explicitly via SDK options.
 */

// ── Types matching on-disk file formats ────────────────────────

interface McpConfigFile {
  mcpServers?: Record<string, {
    command: string;
    args?: string[];
    env?: Record<string, string>;
  }>;
}

interface SettingsFile {
  enabledPlugins?: Record<string, boolean>;
}

interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, {
    scope: string;
    installPath: string;
    version: string;
  }[]>;
}

// ── SDK-compatible output types ────────────────────────────────

export interface McpStdioServerConfig {
  type?: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SdkPluginConfig {
  type: 'local';
  path: string;
}

// ── Cache ──────────────────────────────────────────────────────

const CACHE_TTL = 10 * 60 * 1000; // 10 minutes

let cachedMcpServers: Record<string, McpStdioServerConfig> | null = null;
let mcpCacheTimestamp = 0;
let cachedPlugins: SdkPluginConfig[] | null = null;
let pluginCacheTimestamp = 0;

export function clearClaudeConfigCache(): void {
  cachedMcpServers = null;
  mcpCacheTimestamp = 0;
  cachedPlugins = null;
  pluginCacheTimestamp = 0;
}

// ── Helpers ────────────────────────────────────────────────────

function getClaudeHomeDir(): string {
  return path.join(os.homedir(), '.claude');
}

function readJsonFile<T>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

// ── Public API ─────────────────────────────────────────────────

/**
 * Load MCP server configurations from ~/.claude/mcp.json.
 * Returns a record suitable for the SDK's `mcpServers` option.
 */
export function loadMcpServers(): Record<string, McpStdioServerConfig> {
  if (cachedMcpServers !== null && Date.now() - mcpCacheTimestamp < CACHE_TTL) {
    return cachedMcpServers;
  }

  const claudeHome = getClaudeHomeDir();
  const mcpFile = path.join(claudeHome, 'mcp.json');
  const config = readJsonFile<McpConfigFile>(mcpFile);

  const servers: Record<string, McpStdioServerConfig> = {};
  if (config?.mcpServers) {
    for (const [name, srv] of Object.entries(config.mcpServers)) {
      if (srv.command) {
        servers[name] = {
          command: srv.command,
          ...(srv.args && { args: srv.args }),
          ...(srv.env && { env: srv.env }),
        };
      }
    }
  }

  cachedMcpServers = servers;
  mcpCacheTimestamp = Date.now();

  if (Object.keys(servers).length > 0) {
    console.log(`[Claude Config] Loaded ${Object.keys(servers).length} MCP server(s): ${Object.keys(servers).join(', ')}`);
  }

  return servers;
}

/**
 * Load enabled plugin configurations from ~/.claude/settings.json
 * and ~/.claude/plugins/installed_plugins.json.
 * Returns an array suitable for the SDK's `plugins` option.
 */
export function loadPlugins(): SdkPluginConfig[] {
  if (cachedPlugins !== null && Date.now() - pluginCacheTimestamp < CACHE_TTL) {
    return cachedPlugins;
  }

  const claudeHome = getClaudeHomeDir();

  // Read enabled plugins from settings
  const settingsFile = path.join(claudeHome, 'settings.json');
  const settings = readJsonFile<SettingsFile>(settingsFile);
  const enabledPlugins = settings?.enabledPlugins || {};

  // Read installed plugins registry
  const installedFile = path.join(claudeHome, 'plugins', 'installed_plugins.json');
  const installed = readJsonFile<InstalledPluginsFile>(installedFile);
  const pluginRegistry = installed?.plugins || {};

  const plugins: SdkPluginConfig[] = [];

  for (const [pluginKey, enabled] of Object.entries(enabledPlugins)) {
    if (!enabled) continue;

    const installations = pluginRegistry[pluginKey];
    if (!installations || installations.length === 0) continue;

    // Use the first installation (same pattern as command-scanner.ts)
    const install = installations[0];
    if (install.installPath && fs.existsSync(install.installPath)) {
      plugins.push({ type: 'local', path: install.installPath });
    }
  }

  cachedPlugins = plugins;
  pluginCacheTimestamp = Date.now();

  if (plugins.length > 0) {
    console.log(`[Claude Config] Loaded ${plugins.length} plugin(s)`);
  }

  return plugins;
}
