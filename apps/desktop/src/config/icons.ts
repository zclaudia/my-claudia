/**
 * Unified icon configuration for the application.
 * Skin developers can customize these icons by creating a custom icons file
 * and merging it with this default configuration.
 */

export const ICONS = {
  // Tool icons - used in ToolCallItem component
  tools: {
    Read: '📄',
    Write: '✏️',
    Edit: '📝',
    Bash: '💻',
    Grep: '🔍',
    Glob: '📁',
    Task: '📋',
    WebFetch: '🌐',
    WebSearch: '🔎',
    AskUserQuestion: '❓',
    TodoWrite: '✅',
    NotebookEdit: '📓',
    default: '🔧',
  },

  // File type icons - used in MessageInput for file mentions
  fileTypes: {
    // TypeScript/JavaScript
    '.ts': '📘',
    '.tsx': '⚛️',
    '.js': '📒',
    '.jsx': '⚛️',
    '.mjs': '📒',
    '.cjs': '📒',

    // Python
    '.py': '🐍',
    '.pyw': '🐍',
    '.pyi': '🐍',

    // Data/Config
    '.json': '📋',
    '.yaml': '⚙️',
    '.yml': '⚙️',
    '.toml': '⚙️',
    '.xml': '📋',
    '.csv': '📊',

    // Web
    '.html': '🌐',
    '.htm': '🌐',
    '.css': '🎨',
    '.scss': '🎨',
    '.sass': '🎨',
    '.less': '🎨',

    // Documentation
    '.md': '📝',
    '.mdx': '📝',
    '.txt': '📄',
    '.rst': '📝',

    // Images
    '.png': '🖼️',
    '.jpg': '🖼️',
    '.jpeg': '🖼️',
    '.gif': '🖼️',
    '.svg': '🎨',
    '.webp': '🖼️',
    '.ico': '🖼️',

    // Shell/Scripts
    '.sh': '🐚',
    '.bash': '🐚',
    '.zsh': '🐚',
    '.fish': '🐚',
    '.ps1': '🐚',
    '.bat': '🐚',
    '.cmd': '🐚',

    // Other languages
    '.go': '🐹',
    '.rs': '🦀',
    '.rb': '💎',
    '.php': '🐘',
    '.java': '☕',
    '.kt': '🇰',
    '.swift': '🐦',
    '.c': '🔵',
    '.cpp': '🔵',
    '.h': '🔵',
    '.cs': '🟣',

    // Config/Environment
    '.env': '🔐',
    '.env.local': '🔐',
    '.env.development': '🔐',
    '.env.production': '🔐',
    '.gitignore': '🙈',
    '.dockerignore': '🐳',
    '.eslintrc': '📏',
    '.prettierrc': '💅',

    // Special
    directory: '📁',
    default: '📄',
  },

  // System info icons - used in SystemInfoButton and SystemInfoPanel
  systemInfo: {
    model: '🤖',
    version: '📦',
    permission: '🛡️',
    apiKey: '🔑',
    cwd: '📁',
    tools: '🔧',
    mcpServers: '🖥️',
    agents: '👥',
    info: 'ℹ️',
  },

  // Status icons - used across various components
  status: {
    loading: '⏳',
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
    running: '🔄',
    pending: '⏸️',
  },

  // Message icons - used in LoadingIndicator and message display
  message: {
    assistant: '🤖',
    user: '👤',
    system: '⚙️',
  },
} as const;

// Type exports for type-safe icon access
export type ToolIconKey = keyof typeof ICONS.tools;
export type FileTypeIconKey = keyof typeof ICONS.fileTypes;
export type SystemInfoIconKey = keyof typeof ICONS.systemInfo;
export type StatusIconKey = keyof typeof ICONS.status;
export type MessageIconKey = keyof typeof ICONS.message;

// Helper functions
export function getToolIcon(toolName: string): string {
  return ICONS.tools[toolName as ToolIconKey] || ICONS.tools.default;
}

export function getFileIcon(filename: string, isDirectory = false): string {
  if (isDirectory) {
    return ICONS.fileTypes.directory;
  }
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return ICONS.fileTypes[ext as FileTypeIconKey] || ICONS.fileTypes.default;
}

export function getStatusIcon(status: string): string {
  return ICONS.status[status as StatusIconKey] || ICONS.status.info;
}
