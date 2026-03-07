/**
 * Plugin Platform Types
 *
 * 统一的插件类型定义，所有插件相关类型都在此文件中。
 * 文件位置: shared/src/plugin-types.ts
 *
 * 注意: UI 组件类型使用泛型定义，具体 React 类型在桌面应用中定义。
 */

// ============================================
// Tool Definition Types
// ============================================

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface AIToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

// ============================================
// Permission
// ============================================

export type Permission =
  // 安全级别
  | 'session.read'
  | 'project.read'
  | 'storage'
  // 中等级别
  | 'fs.read'
  | 'network.fetch'
  | 'timer'
  | 'provider.call' // 调用 AI Provider
  // 敏感级别
  | 'fs.write'
  | 'session.write'
  | 'notification'
  | 'clipboard.read'
  | 'clipboard.write'
  // 危险级别
  | 'shell.execute';

// ============================================
// Plugin Manifest
// ============================================

export interface PluginAuthor {
  name: string;
  email?: string;
  url?: string;
}

export interface PluginEngines {
  claudia: string; // semver range, e.g., ">=0.1.0"
}

export interface CommandContribution {
  command: string; // e.g., '/my-command'
  title: string;
  category?: string;
  icon?: string;
}

export interface ToolContribution {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  scope?: ('agent-assistant' | 'main-session' | 'command-palette')[];
  permissions?: Permission[];
}

export interface SettingsContribution {
  id: string;
  label: string;
  icon?: string;
  schema?: Record<string, unknown>;
  defaults?: Record<string, unknown>;
}

export interface PanelContribution {
  id: string;
  label: string;
  location: 'bottom' | 'sidebar' | 'right';
  icon?: string;
  size?: number;
}

export interface HookContribution {
  event: string;
  handler: string;
  priority?: number;
}

export interface MenuContribution {
  id: string;
  location: 'context-menu' | 'toolbar' | 'status-bar';
  label: string;
  command?: string;
  icon?: string;
  when?: string;
}

export interface KeybindingContribution {
  command: string;
  key: string;
  when?: string;
}

export interface UIExtensionPoint {
  id: string;
  location: 'sidebar' | 'panel' | 'toolbar' | 'context-menu' | 'status-bar';
  component?: string; // Path to component module
  when?: string;
}

export interface PluginContributes {
  commands?: CommandContribution[];
  tools?: ToolContribution[];
  settings?: SettingsContribution;
  panels?: PanelContribution[];
  hooks?: HookContribution[];
  uiExtensions?: UIExtensionPoint[];
  menus?: MenuContribution[];
  keybindings?: KeybindingContribution[];
}

export type ExecutionMode = 'main' | 'worker' | 'sandbox';

export interface PluginManifest {
  id: string; // e.g., 'com.example.my-plugin'
  name: string;
  version: string;
  description: string;
  author?: PluginAuthor;
  icon?: string;

  main?: string; // Backend entry (server-side)
  frontend?: string; // Frontend entry (UI extensions)

  permissions?: Permission[];

  contributes?: PluginContributes;

  // 执行模式
  executionMode?: ExecutionMode;

  // 激活事件
  activationEvents?: string[];

  // 兼容性声明
  engines?: PluginEngines;

  // 插件依赖
  dependencies?: Record<string, string>; // pluginId → semver range
}

// ============================================
// Plugin Instance (Runtime)
// ============================================

export interface PluginInstance {
  manifest: PluginManifest;
  path: string;
  isActive: boolean;
  module?: unknown;
  error?: string;
  /** Permissions not yet granted — will be requested on first tool/command use */
  pendingPermissions?: string[];
}

// ============================================
// Plugin Context
// ============================================

export interface EventAPI {
  on(event: string, handler: EventHandler): () => void;
  once(event: string, handler: EventHandler): void;
  off(event: string, handler: EventHandler): void;
  emit(event: string, data: unknown): Promise<void>;
}

export interface StorageAPI {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export interface LogAPI {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

export interface FileSystemAPI {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readdir(path: string): Promise<string[]>;
  mkdir(path: string): Promise<void>;
  unlink(path: string): Promise<void>;
}

export interface NetworkAPI {
  fetch(url: string, options?: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: string }>;
}

export interface NotificationAPI {
  show(title: string, body: string): Promise<void>;
}

export interface ClipboardAPI {
  read(): Promise<string>;
  write(text: string): Promise<void>;
}

export interface ShellAPI {
  execute(command: string, args?: string[], options?: { cwd?: string }): Promise<{ stdout: string; stderr: string; code: number }>;
}

export interface SessionAPI {
  getActive(): Promise<{ id: string; projectId: string } | null>;
  getById(id: string): Promise<unknown>;
  list(): Promise<unknown[]>;
}

export interface ProjectAPI {
  getActive(): Promise<{ id: string; name: string; path: string } | null>;
  getById(id: string): Promise<unknown>;
  list(): Promise<unknown[]>;
}

export interface UIComponents {
  // Runtime injected components (generic types, concrete React types in desktop app)
  Button: unknown;
  Input: unknown;
  Card: unknown;
  Badge: unknown;
}

export interface UIAPI {
  components: UIComponents;
  showPanel(panelId: string): void;
  showNotification(message: string): void;
}

// ============================================
// Provider API Types
// ============================================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ProviderInfo {
  id: string;
  name: string;
  type: string;
  models: string[];
  isDefault?: boolean;
}

export interface ProviderCallOptions {
  providerId: string;
  modelOverride?: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  stream?: boolean;
}

export interface ProviderCallResult {
  content: string;
  model: string;
  providerId: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
  metadata?: Record<string, unknown>;
  // For multi-model collaboration
  isComplete?: boolean;
  suggestedNextSteps?: string[];
}

export interface ProviderStreamChunk {
  type: 'content' | 'usage' | 'done' | 'error';
  content?: string;
  delta?: string;
  usage?: { inputTokens: number; outputTokens: number };
  error?: string;
}

export interface ProviderAPI {
  /**
   * List available providers
   */
  list(): Promise<ProviderInfo[]>;

  /**
   * Get a specific provider by ID
   */
  get(providerId: string): Promise<ProviderInfo | undefined>;

  /**
   * Call a provider with messages (non-streaming)
   */
  call(options: ProviderCallOptions): Promise<ProviderCallResult>;

  /**
   * Call a provider with streaming response
   */
  callStream(options: ProviderCallOptions): AsyncGenerator<ProviderStreamChunk>;
}

export interface PluginContext {
  pluginId: string;

  // 事件系统
  events: EventAPI;

  // 注册扩展
  registerCommand(command: string, handler: CommandHandler): void;
  registerTool(meta: ToolRegistration): void;
  registerUIExtension(extension: UIExtensionRegistration): void;

  // 持久化存储
  storage: StorageAPI;

  // 基础 API（按权限提供）
  fs?: FileSystemAPI;
  network?: NetworkAPI;
  notification?: NotificationAPI;
  clipboard?: ClipboardAPI;
  shell?: ShellAPI;

  // 应用 API
  session?: SessionAPI;
  project?: ProjectAPI;
  ui?: UIAPI;

  // AI Provider API（按权限提供）
  providers?: ProviderAPI;

  // 插件间通信
  exports<T>(api: T): void;
  getPluginAPI<T>(pluginId: string): T | undefined;

  // 日志
  log: LogAPI;

  // 环境
  env: {
    isDesktop: boolean;
    isServer: boolean;
    appVersion: string;
    platform: 'darwin' | 'win32' | 'linux';
  };
}

// ============================================
// Handler Types
// ============================================

export type EventHandler = (data: unknown) => void | Promise<void>;

export type CommandHandler = (args: string[], context?: Record<string, unknown>) => Promise<unknown> | unknown;

export type ToolHandler = (args: Record<string, unknown>, context?: Record<string, unknown>) => Promise<string> | string;

// ============================================
// Registration Types
// ============================================

export interface ToolRegistration {
  id: string;
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler;
  scope?: ('agent-assistant' | 'main-session' | 'command-palette')[];
}

export interface UIExtensionRegistration {
  id: string;
  location: 'sidebar' | 'panel' | 'toolbar' | 'context-menu' | 'status-bar';
  component: unknown; // Generic type, concrete React.ComponentType in desktop app
  when?: (context: unknown) => boolean;
}

// ============================================
// Plugin Module Interface
// ============================================

export interface PluginModule {
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}

// ============================================
// Validation
// ============================================

export interface PluginValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate a plugin manifest
 */
export function validatePluginManifest(manifest: unknown): PluginValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be an object'], warnings: [] };
  }

  const m = manifest as Record<string, unknown>;

  // Required fields
  if (!m.id || typeof m.id !== 'string') {
    errors.push('Missing required field: id');
  } else if (!/^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/.test(m.id as string)) {
    errors.push('Invalid id format (use reverse domain notation, e.g., com.example.plugin)');
  }

  if (!m.name || typeof m.name !== 'string') {
    errors.push('Missing required field: name');
  }

  if (!m.version || typeof m.version !== 'string') {
    errors.push('Missing required field: version');
  } else if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(m.version as string)) {
    warnings.push('Version should follow semver format (e.g., 1.0.0)');
  }

  if (!m.description || typeof m.description !== 'string') {
    errors.push('Missing required field: description');
  }

  // Validate engines
  if (m.engines && typeof m.engines === 'object') {
    const engines = m.engines as Record<string, unknown>;
    if (!engines.claudia || typeof engines.claudia !== 'string') {
      warnings.push('engines.claudia should specify a semver range');
    }
  }

  // Validate contributions
  if (m.contributes && typeof m.contributes === 'object') {
    const contributes = m.contributes as Record<string, unknown>;

    if (contributes.commands && Array.isArray(contributes.commands)) {
      for (const cmd of contributes.commands) {
        if (!cmd.command || typeof cmd.command !== 'string') {
          errors.push('Command contribution missing "command" field');
        }
        if (!cmd.title || typeof cmd.title !== 'string') {
          errors.push('Command contribution missing "title" field');
        }
      }
    }

    if (contributes.tools && Array.isArray(contributes.tools)) {
      for (const tool of contributes.tools) {
        if (!tool.id || typeof tool.id !== 'string') {
          errors.push('Tool contribution missing "id" field');
        }
        if (!tool.name || typeof tool.name !== 'string') {
          errors.push('Tool contribution missing "name" field');
        }
        if (!tool.description || typeof tool.description !== 'string') {
          errors.push('Tool contribution missing "description" field');
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}
