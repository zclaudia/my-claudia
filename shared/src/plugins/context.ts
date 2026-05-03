import type { CapabilityNegotiationResult } from './capabilities.js';
import type { PluginManifest } from './manifest.js';
import type { ToolRegistration } from './tools.js';
import type { UIExtensionRegistration } from './contributions.js';
import type {
  EventAPI,
  StorageAPI,
  LogAPI,
  FileSystemAPI,
  NetworkAPI,
  NotificationAPI,
  ClipboardAPI,
  ShellAPI,
  SessionAPI,
  ProjectAPI,
  UIAPI,
  ProviderAPI,
  McpAPI,
  PluginSchedulerAPI,
} from './runtime-apis.js';

export type CommandHandler = (args: string[], context?: Record<string, unknown>) => Promise<unknown> | unknown;

export interface PluginContext {
  pluginId: string;

  events: EventAPI;

  commands: {
    registerCommand(command: string, handler: CommandHandler): void;
    unregisterCommand(command: string): void;
  };
  tools: {
    registerTool(meta: ToolRegistration): void;
    unregisterTool(toolId: string): void;
  };
  /** @deprecated Use commands.registerCommand() instead. */
  registerCommand(command: string, handler: CommandHandler): void;
  /** @deprecated Use tools.registerTool() instead. */
  registerTool(meta: ToolRegistration): void;
  registerUIExtension(extension: UIExtensionRegistration): void;

  storage: StorageAPI;

  // 基础 API（按权限提供）
  fs?: FileSystemAPI;
  network?: NetworkAPI;
  notification?: NotificationAPI;
  clipboard?: ClipboardAPI;
  shell?: ShellAPI;
  scheduler?: PluginSchedulerAPI;

  // 应用 API
  session?: SessionAPI;
  project?: ProjectAPI;
  ui?: UIAPI;

  // AI Provider API（按权限提供）
  providers?: ProviderAPI;

  // MCP API（按 network.fetch 权限提供）
  mcp?: McpAPI;

  capabilities?: CapabilityNegotiationResult;

  // 插件间通信
  exports<T>(api: T): void;
  getPluginAPI<T>(pluginId: string): T | undefined;

  log: LogAPI;

  env: {
    isDesktop: boolean;
    isServer: boolean;
    appVersion: string;
    platform: 'darwin' | 'win32' | 'linux';
  };
}

export interface PluginInstance {
  manifest: PluginManifest;
  path: string;
  isActive: boolean;
  module?: unknown;
  error?: string;
  pendingPermissions?: string[];
  capabilities?: CapabilityNegotiationResult;
}

export interface PluginModule {
  activate(context: PluginContext): Promise<void> | void;
  deactivate?(): Promise<void> | void;
}
