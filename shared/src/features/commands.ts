// Slash Command Types

export type SlashCommandSource = 'local' | 'provider' | 'custom' | 'plugin';
export type SlashCommandScope = 'global' | 'project';

export interface SlashCommand {
  command: string;        // e.g., '/cost', '/clear', '/project:my-command', '/commit-commands:commit'
  description: string;    // Displayed in autocomplete
  source: SlashCommandSource;  // 'local' = frontend, 'provider' = built-in, 'custom' = user-defined, 'plugin' = CLI plugin
  scope?: SlashCommandScope;   // For custom commands: 'global' (~/.claude) or 'project' (.claude)
  filePath?: string;      // For custom/plugin commands: path to the .md file
}

// Fallback Claude commands (used when CLI is not available for dynamic discovery)
export const CLAUDE_FALLBACK_COMMANDS: SlashCommand[] = [
  // Session management
  { command: '/compact', description: 'Compact conversation history', source: 'provider' },
  { command: '/context', description: 'Show context usage', source: 'provider' },
  { command: '/cost', description: 'Show token usage and cost', source: 'provider' },
  { command: '/status', description: 'Show account and system info', source: 'provider' },
  { command: '/export', description: 'Export conversation', source: 'provider' },
  // Configuration
  { command: '/config', description: 'Open Claude config', source: 'provider' },
  { command: '/memory', description: 'Edit CLAUDE.md memory', source: 'provider' },
  { command: '/init', description: 'Initialize project with CLAUDE.md', source: 'provider' },
  { command: '/allowed-tools', description: 'Configure tool permissions', source: 'provider' },
  { command: '/permissions', description: 'Review current permissions', source: 'provider' },
  { command: '/hooks', description: 'Configure hooks', source: 'provider' },
  // Account
  { command: '/login', description: 'Login to Claude', source: 'provider' },
  { command: '/logout', description: 'Logout from Claude', source: 'provider' },
  // Tools & integrations
  { command: '/doctor', description: 'Diagnose installation issues', source: 'provider' },
  { command: '/mcp', description: 'Manage MCP servers', source: 'provider' },
  { command: '/agents', description: 'Manage agents', source: 'provider' },
  { command: '/plugin', description: 'Manage plugins', source: 'provider' },
  { command: '/ide', description: 'Manage IDE integrations', source: 'provider' },
  { command: '/shells', description: 'Manage background shells', source: 'provider' },
  // Code workflow
  { command: '/review', description: 'Request code review', source: 'provider' },
  { command: '/pr-comments', description: 'View PR review comments', source: 'provider' },
  // UI/UX
  { command: '/vim', description: 'Toggle vim mode', source: 'provider' },
  { command: '/terminal-setup', description: 'Setup terminal integration', source: 'provider' },
  { command: '/install-github-app', description: 'Install GitHub App', source: 'provider' },
];

// Local UI commands (always available, handled by frontend)
export const LOCAL_COMMANDS: SlashCommand[] = [
  { command: '/clear', description: 'Clear chat history', source: 'local' },
  { command: '/help', description: 'Show help information', source: 'local' },
  { command: '/model', description: 'Show current model/provider info', source: 'local' },
  { command: '/status', description: 'Show system status', source: 'local' },
  { command: '/cost', description: 'Show token usage', source: 'local' },
  { command: '/memory', description: 'Show CLAUDE.md info', source: 'local' },
  { command: '/config', description: 'Open settings', source: 'local' },
  { command: '/new-session', description: 'Create new session', source: 'local' },
  { command: '/reload', description: 'Reload custom commands', source: 'local' },
  { command: '/worktree', description: 'Switch to or view current worktree', source: 'local' },
  { command: '/create-worktree', description: 'Create a new git worktree and switch to it', source: 'local' },
];

// CLI pass-through commands (sent directly to Claude SDK)
// Note: /compact and /context were removed because they don't produce output through SDK
// Users should use these commands directly in Claude CLI if needed
export const CLI_COMMANDS: SlashCommand[] = [];

// Command Execution Types

export type CommandType = 'builtin' | 'custom';

export interface CommandExecuteRequest {
  commandName: string;
  commandPath?: string;   // For custom commands: path to .md file
  args?: string[];
  context?: {
    projectPath?: string;
    projectName?: string;
    sessionId?: string;
    provider?: string;
    model?: string;
    tokenUsage?: { used: number; total: number };
  };
}

export interface CommandExecuteResponse {
  type: CommandType;
  command: string;
  action?: string;        // For builtin: 'clear', 'help', 'model', 'cost', 'status', etc.
  data?: Record<string, unknown>;
  content?: string;       // For custom: processed command content
  error?: string;
}
