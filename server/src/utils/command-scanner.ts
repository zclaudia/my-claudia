import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { SlashCommand } from '@my-claudia/shared';

/**
 * Scans for custom slash commands in .claude/commands directories
 * and plugin commands from installed Claude CLI plugins
 *
 * Custom commands are stored as markdown files:
 * - Global: ~/.claude/commands/*.md
 * - Project: <projectRoot>/.claude/commands/*.md
 *
 * Plugin commands are stored in:
 * - ~/.claude/plugins/installed_plugins.json (plugin registry)
 * - Each plugin's installPath/commands/*.md or installPath/*.md
 *
 * The command name is derived from the filename:
 * - Global: review.md -> /review
 * - Project: fix-issue.md -> /fix-issue
 * - Plugin: code-review.md from plugin "code-review" -> /code-review:code-review
 */

interface ScanOptions {
  projectRoot?: string;  // If provided, also scan project-level commands
  includePlugins?: boolean;  // If true, also scan plugin commands (default: true)
}

// Structure of installed_plugins.json
interface InstalledPluginsFile {
  version: number;
  plugins: Record<string, PluginInstallation[]>;
}

interface PluginInstallation {
  scope: 'user' | 'project';
  installPath: string;
  version: string;
  installedAt: string;
  lastUpdated: string;
}

// Structure of plugin.json
interface PluginManifest {
  name: string;
  description: string;
  author?: {
    name: string;
    email?: string;
  };
}

/**
 * Extract description from markdown file
 * First checks YAML frontmatter for 'description' field,
 * then falls back to first non-empty line or first heading
 */
function extractDescription(content: string): string {
  // Check for YAML frontmatter
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      const frontmatter = content.substring(3, endIndex);
      // Simple YAML parsing for description field
      const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
      if (descMatch) {
        const desc = descMatch[1].trim();
        return desc.length > 80 ? desc.substring(0, 77) + '...' : desc;
      }
    }
  }

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // If it's a heading, extract the text
    if (trimmed.startsWith('#')) {
      return trimmed.replace(/^#+\s*/, '').trim();
    }

    // Use first non-empty, non-heading line
    if (!trimmed.startsWith('---')) {  // Skip frontmatter separators
      // Limit description length
      return trimmed.length > 80 ? trimmed.substring(0, 77) + '...' : trimmed;
    }
  }

  return 'Custom command';
}

/**
 * Scan a directory for command files
 */
function scanDirectory(
  dir: string,
  scope: 'global' | 'project'
): SlashCommand[] {
  const commands: SlashCommand[] = [];

  if (!fs.existsSync(dir)) {
    return commands;
  }

  try {
    const files = fs.readdirSync(dir);

    for (const file of files) {
      // Only process .md files
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);

      if (!stat.isFile()) continue;

      // Extract command name from filename
      const baseName = path.basename(file, '.md');

      // Command name: /<baseName> for both global and project scopes
      // (matches Claude Code CLI behavior — project commands don't need a prefix)
      const commandName = `/${baseName}`;

      // Read file content to extract description
      let description = 'Custom command';
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        description = extractDescription(content);
      } catch {
        // Use default description if file can't be read
      }

      commands.push({
        command: commandName,
        description,
        source: 'custom',
        scope,
        filePath,
      });
    }
  } catch (error) {
    console.error(`Error scanning directory ${dir}:`, error);
  }

  return commands;
}

/**
 * Scan plugin commands from installed Claude CLI plugins
 */
function scanPluginCommands(): SlashCommand[] {
  const commands: SlashCommand[] = [];
  const pluginsFile = path.join(os.homedir(), '.claude', 'plugins', 'installed_plugins.json');

  if (!fs.existsSync(pluginsFile)) {
    return commands;
  }

  try {
    const content = fs.readFileSync(pluginsFile, 'utf-8');
    const pluginsData: InstalledPluginsFile = JSON.parse(content);

    for (const [pluginKey, installations] of Object.entries(pluginsData.plugins)) {
      // Plugin key format: "name@marketplace" e.g. "commit-commands@claude-plugins-official"
      const pluginName = pluginKey.split('@')[0];

      // Get the first (usually only) installation
      const installation = installations[0];
      if (!installation?.installPath) continue;

      const installPath = installation.installPath;
      if (!fs.existsSync(installPath)) continue;

      // Scan for command files in the plugin
      // Commands can be in:
      // 1. <installPath>/commands/*.md
      // 2. <installPath>/*.md (excluding README.md)
      const commandsDir = path.join(installPath, 'commands');
      const locations = [
        { dir: commandsDir, exists: fs.existsSync(commandsDir) },
        { dir: installPath, exists: true }
      ];

      for (const { dir, exists } of locations) {
        if (!exists) continue;

        try {
          const files = fs.readdirSync(dir);

          for (const file of files) {
            // Only process .md files, exclude common documentation files
            const lowerFile = file.toLowerCase();
            const excludedFiles = [
              'readme.md',
              'contributing.md',
              'code_of_conduct.md',
              'changelog.md',
              'license.md',
              'security.md'
            ];
            if (!file.endsWith('.md') || excludedFiles.includes(lowerFile)) continue;

            const filePath = path.join(dir, file);
            const stat = fs.statSync(filePath);

            if (!stat.isFile()) continue;

            // Extract command name from filename
            const baseName = path.basename(file, '.md');

            // Build command name: /plugin-name:command-name
            // e.g., /commit-commands:commit, /code-review:code-review
            const commandName = `/${pluginName}:${baseName}`;

            // Read file content to extract description
            let description = 'Plugin command';
            try {
              const fileContent = fs.readFileSync(filePath, 'utf-8');
              description = extractDescription(fileContent);
            } catch {
              // Use default description if file can't be read
            }

            // Get plugin description from manifest
            let pluginDescription = '';
            const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
            if (fs.existsSync(manifestPath)) {
              try {
                const manifest: PluginManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
                pluginDescription = ` (plugin:${pluginName}@${manifest.author?.name || 'unknown'})`;
              } catch {
                pluginDescription = ` (plugin:${pluginName})`;
              }
            } else {
              pluginDescription = ` (plugin:${pluginName})`;
            }

            commands.push({
              command: commandName,
              description: description + pluginDescription,
              source: 'plugin',
              scope: 'global',
              filePath,
            });
          }
        } catch (error) {
          console.error(`Error scanning plugin directory ${dir}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Error reading installed plugins:', error);
  }

  return commands;
}

/**
 * Scan for all custom commands
 */
export function scanCustomCommands(options: ScanOptions = {}): SlashCommand[] {
  const commands: SlashCommand[] = [];
  const includePlugins = options.includePlugins !== false;  // Default to true

  // Scan global commands (~/.claude/commands)
  const globalDir = path.join(os.homedir(), '.claude', 'commands');
  const globalCommands = scanDirectory(globalDir, 'global');

  // Scan project commands if projectRoot is provided
  // Project commands take priority over global ones with the same name
  if (options.projectRoot) {
    const projectDir = path.join(options.projectRoot, '.claude', 'commands');
    const projectCommands = scanDirectory(projectDir, 'project');
    const projectNames = new Set(projectCommands.map(c => c.command));
    commands.push(...projectCommands);
    commands.push(...globalCommands.filter(c => !projectNames.has(c.command)));
  } else {
    commands.push(...globalCommands);
  }

  // Scan plugin commands
  if (includePlugins) {
    commands.push(...scanPluginCommands());
  }

  return commands;
}

/**
 * Get the full path to the global commands directory
 */
export function getGlobalCommandsDir(): string {
  return path.join(os.homedir(), '.claude', 'commands');
}

/**
 * Get the full path to a project's commands directory
 */
export function getProjectCommandsDir(projectRoot: string): string {
  return path.join(projectRoot, '.claude', 'commands');
}
