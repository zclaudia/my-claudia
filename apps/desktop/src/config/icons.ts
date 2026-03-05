/**
 * Unified icon configuration for the application.
 * Uses Lucide React icons (closest to Apple SF Symbols on the web).
 */
import {
  FileText, Pencil, FileEdit, Terminal, Search, FolderSearch,
  ClipboardList, Globe, SearchCode, HelpCircle, CheckSquare,
  BookOpen, ClipboardCheck, Wrench,
  // File types
  FileCode, File, FileJson, Image, Palette,
  FolderClosed, Code2, Coffee, Bird, Gem,
  FileSpreadsheet, Sparkles, Lock, EyeOff, Ruler,
  // Status
  Loader2, CheckCircle2, XCircle, AlertTriangle, Info, RefreshCw, Pause,
  // System
  Cpu, Package, Shield, Key, Folder, Monitor, Users,
  // Message
  Bot, User, Cog,
  type LucideIcon,
} from 'lucide-react';

export type { LucideIcon };

export const ICONS = {
  // Tool icons — used in ToolCallItem component
  tools: {
    Read: FileText,
    Write: Pencil,
    Edit: FileEdit,
    Bash: Terminal,
    Grep: Search,
    Glob: FolderSearch,
    Task: ClipboardList,
    WebFetch: Globe,
    WebSearch: SearchCode,
    AskUserQuestion: HelpCircle,
    TodoWrite: CheckSquare,
    NotebookEdit: BookOpen,
    ExitPlanMode: ClipboardCheck,
    EnterPlanMode: ClipboardList,
    default: Wrench,
  },

  // File type icons — used in MessageInput for file mentions
  fileTypes: {
    // TypeScript/JavaScript
    '.ts': FileCode,
    '.tsx': Code2,
    '.js': FileCode,
    '.jsx': Code2,
    '.mjs': FileCode,
    '.cjs': FileCode,

    // Python
    '.py': FileCode,
    '.pyw': FileCode,
    '.pyi': FileCode,

    // Data/Config
    '.json': FileJson,
    '.yaml': Cog,
    '.yml': Cog,
    '.toml': Cog,
    '.xml': FileCode,
    '.csv': FileSpreadsheet,

    // Web
    '.html': Globe,
    '.htm': Globe,
    '.css': Palette,
    '.scss': Palette,
    '.sass': Palette,
    '.less': Palette,

    // Documentation
    '.md': FileText,
    '.mdx': FileText,
    '.txt': File,
    '.rst': FileText,

    // Images
    '.png': Image,
    '.jpg': Image,
    '.jpeg': Image,
    '.gif': Image,
    '.svg': Palette,
    '.webp': Image,
    '.ico': Image,

    // Shell/Scripts
    '.sh': Terminal,
    '.bash': Terminal,
    '.zsh': Terminal,
    '.fish': Terminal,
    '.ps1': Terminal,
    '.bat': Terminal,
    '.cmd': Terminal,

    // Other languages
    '.go': FileCode,
    '.rs': FileCode,
    '.rb': Gem,
    '.php': FileCode,
    '.java': Coffee,
    '.kt': FileCode,
    '.swift': Bird,
    '.c': FileCode,
    '.cpp': FileCode,
    '.h': FileCode,
    '.cs': FileCode,

    // Config/Environment
    '.env': Lock,
    '.env.local': Lock,
    '.env.development': Lock,
    '.env.production': Lock,
    '.gitignore': EyeOff,
    '.dockerignore': EyeOff,
    '.eslintrc': Ruler,
    '.prettierrc': Sparkles,

    // Special
    directory: FolderClosed,
    default: File,
  },

  // System info icons — used in SystemInfoButton and SystemInfoPanel
  systemInfo: {
    model: Cpu,
    version: Package,
    permission: Shield,
    apiKey: Key,
    cwd: Folder,
    tools: Wrench,
    mcpServers: Monitor,
    agents: Users,
    info: Info,
  },

  // Status icons — used across various components
  status: {
    loading: Loader2,
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
    running: RefreshCw,
    pending: Pause,
  },

  // Message icons — used in LoadingIndicator and message display
  message: {
    assistant: Bot,
    user: User,
    system: Cog,
  },
} as const;

// Type exports for type-safe icon access
export type ToolIconKey = keyof typeof ICONS.tools;
export type FileTypeIconKey = keyof typeof ICONS.fileTypes;
export type SystemInfoIconKey = keyof typeof ICONS.systemInfo;
export type StatusIconKey = keyof typeof ICONS.status;
export type MessageIconKey = keyof typeof ICONS.message;

// Helper functions — return LucideIcon components
export function getToolIcon(toolName: string): LucideIcon {
  return ICONS.tools[toolName as ToolIconKey] || ICONS.tools.default;
}

export function getFileIcon(filename: string, isDirectory = false): LucideIcon {
  if (isDirectory) {
    return ICONS.fileTypes.directory;
  }
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0] || '';
  return ICONS.fileTypes[ext as FileTypeIconKey] || ICONS.fileTypes.default;
}

export function getStatusIcon(status: string): LucideIcon {
  return ICONS.status[status as StatusIconKey] || ICONS.status.info;
}
