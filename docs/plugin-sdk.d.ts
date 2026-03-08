/**
 * Claudia Plugin SDK — TypeScript Type Declarations
 *
 * Copy this file into your plugin project to get full type safety and
 * IntelliSense when developing Claudia plugins.
 *
 * Usage in tsconfig.json:
 *   { "compilerOptions": { "typeRoots": ["./types"] } }
 *
 * Or reference directly:
 *   /// <reference path="./plugin-sdk.d.ts" />
 */

// ============================================================
// Permissions
// ============================================================

export type Permission =
  // Safe (level 1)
  | 'session.read'     // Read session history
  | 'project.read'     // Read project metadata
  | 'storage'          // Persistent plugin storage (isolated per plugin)
  // Medium (level 2)
  | 'fs.read'          // Read files from filesystem
  | 'network.fetch'    // Make HTTP/HTTPS requests
  | 'timer'            // Schedule timers
  | 'provider.call'    // Call AI providers
  // Sensitive (level 3)
  | 'fs.write'         // Write files to filesystem
  | 'session.write'    // Modify session data
  | 'notification'     // Show system notifications
  | 'clipboard.read'   // Read clipboard content
  | 'clipboard.write'  // Write to clipboard
  // Dangerous (level 4)
  | 'shell.execute';   // Execute shell commands

// ============================================================
// Plugin Manifest (plugin.json)
// ============================================================

export interface PluginManifest {
  /** Unique plugin ID in reverse-domain format: "com.company.plugin-name" */
  id: string;
  name: string;
  /** Semver string: "1.0.0" */
  version: string;
  description: string;
  author?: { name: string; email?: string; url?: string };
  icon?: string;

  /** Server-side entry point (Node.js module), e.g. "dist/index.js" */
  main?: string;

  /** Execution mode. Default: "main" (runs in server process) */
  executionMode?: 'main' | 'worker';

  /** Permissions requested from the user on first use */
  permissions?: Permission[];

  /** Version compatibility range, e.g. { "claudia": ">=0.1.0" } */
  engines?: { claudia: string };

  /** Plugin IDs this plugin depends on */
  dependencies?: Record<string, string>;

  contributes?: {
    /** Slash commands shown in the command palette */
    commands?: Array<{
      /** Must start with "/" e.g. "/my-cmd" */
      command: string;
      title: string;
      category?: string;
    }>;

    /** Tools available to AI models via function calling */
    tools?: Array<{
      id: string;
      name: string;
      description: string;
      /** JSON Schema for parameters */
      parameters: Record<string, unknown>;
      permissions?: Permission[];
    }>;

    /** UI panels shown in the bottom panel area */
    panels?: Array<{
      id: string;
      label: string;
      location?: 'bottom' | 'sidebar' | 'right';
      icon?: string;
      /**
       * Relative path to the HTML entry for your panel UI.
       * The file is served at /api/plugins/{pluginId}/frontend/{frontend}
       * and loaded in an iframe. Example: "ui/index.html"
       */
      frontend?: string;
      order?: number;
    }>;
  };
}

// ============================================================
// Plugin Context (passed to activate())
// ============================================================

export interface StorageAPI {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  clear(): Promise<void>;
}

export interface LogAPI {
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
}

export interface EventAPI {
  /** Subscribe to a system event. Returns an unsubscribe function. */
  on(event: PluginEventType | string, handler: (data: unknown) => void | Promise<void>): () => void;
  /** Subscribe to an event, unsubscribes automatically after first trigger. */
  once(event: PluginEventType | string, handler: (data: unknown) => void | Promise<void>): void;
  /** Emit a custom event (will be received by other plugins). */
  emit(event: string, data?: unknown): Promise<void>;
}

export interface FileSystemAPI {
  readFile(filePath: string): Promise<string>;
  writeFile(filePath: string, content: string): Promise<void>;
  exists(filePath: string): Promise<boolean>;
  readdir(dirPath: string): Promise<string[]>;
  mkdir(dirPath: string): Promise<void>;
  unlink(filePath: string): Promise<void>;
}

export interface NetworkAPI {
  fetch(url: string, options?: RequestInit): Promise<{
    ok: boolean;
    status: number;
    body: string;
  }>;
}

export interface ShellAPI {
  execute(command: string, args?: string[], options?: { cwd?: string }): Promise<{
    stdout: string;
    stderr: string;
    code: number;
  }>;
}

export interface NotificationAPI {
  show(title: string, body: string): Promise<void>;
}

export interface ClipboardAPI {
  read(): Promise<string>;
  write(text: string): Promise<void>;
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

export interface PermissionsAPI {
  hasPermission(permission: Permission): boolean;
  hasAllPermissions(permissions: Permission[]): boolean;
  requestPermission(permission: Permission): Promise<boolean>;
  requestPermissions(permissions: Permission[]): Promise<boolean>;
  getGrantedPermissions(): Permission[];
}

export interface CommandsAPI {
  registerCommand(
    command: string,
    handler: (args: string[], context?: CommandContext) => Promise<CommandResult> | CommandResult
  ): void;
  unregisterCommand(command: string): void;
}

export interface ToolsAPI {
  registerTool(tool: {
    id: string;
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    handler: (args: Record<string, unknown>) => Promise<string> | string;
    permissions?: Permission[];
  }): void;
  unregisterTool(toolId: string): void;
}

export interface UIAPI {
  /** Open a panel in the bottom panel area by its ID (must be registered in contributes.panels) */
  showPanel(panelId: string): void;
  /** Display a transient notification in the UI */
  showNotification(message: string): void;
}

export interface PluginContext {
  /** This plugin's ID */
  pluginId: string;
  /** This plugin's version */
  version: string;
  /** Absolute path to this plugin's directory */
  extensionPath: string;

  /** Persistent key-value storage (5 MB limit, isolated per plugin) */
  storage: StorageAPI;
  /** Structured logging — auto-prefixed with [pluginId] */
  log: LogAPI;
  /** System event bus */
  events: EventAPI;
  /** Register slash commands */
  commands: CommandsAPI;
  /** Register AI tools */
  tools: ToolsAPI;
  /** Permission management */
  permissions: PermissionsAPI;
  /** UI interactions */
  ui: UIAPI;

  // These are only available if the plugin declared the corresponding permission:
  /** File system access. Requires "fs.read" and/or "fs.write" permissions. */
  fs?: FileSystemAPI;
  /** HTTP requests. Requires "network.fetch" permission. */
  network?: NetworkAPI;
  /** Shell execution. Requires "shell.execute" permission. */
  shell?: ShellAPI;
  /** System notifications. Requires "notification" permission. */
  notification?: NotificationAPI;
  /** Clipboard. Requires "clipboard.read" and/or "clipboard.write" permissions. */
  clipboard?: ClipboardAPI;
  /** Session data. Requires "session.read" permission. */
  session?: SessionAPI;
  /** Project data. Requires "project.read" permission. */
  project?: ProjectAPI;

  /** Export a public API for other plugins to consume via getPluginAPI() */
  exports<T>(api: T): void;
  /** Get the exported API of another active plugin */
  getPluginAPI<T>(pluginId: string): T | undefined;

  env: {
    isDesktop: boolean;
    isServer: boolean;
    appVersion: string;
    platform: 'darwin' | 'win32' | 'linux';
  };
}

// ============================================================
// Command Handler Types
// ============================================================

export interface CommandContext {
  projectPath?: string;
  projectName?: string;
  sessionId?: string;
  provider?: string;
  model?: string;
}

export interface CommandResult {
  type: 'builtin';
  command: string;
  /** Determines how the frontend handles the result */
  action?: 'show_panel' | 'default' | string;
  data?: Record<string, unknown>;
  error?: string;
}

// ============================================================
// Plugin Module Interface
// ============================================================

export interface PluginModule {
  /** Called when the plugin is activated. Register commands, tools, and event listeners here. */
  activate(context: PluginContext): void | Promise<void>;
  /** Called when the plugin is deactivated. Unsubscribe from events and clean up here. */
  deactivate?(): void | Promise<void>;
}

// ============================================================
// System Event Types
// ============================================================

export type PluginEventType =
  // Plugin lifecycle
  | 'plugin.loaded'
  | 'plugin.activated'
  | 'plugin.deactivated'
  | 'plugin.error'
  // AI runs
  | 'run.started'
  | 'run.completed'
  | 'run.error'
  | 'run.message'
  | 'run.toolCall'
  | 'run.toolResult'
  // Sessions
  | 'session.created'
  | 'session.deleted'
  | 'session.archived'
  | 'session.restored'
  // Projects
  | 'project.opened'
  | 'project.closed'
  // System
  | 'provider.changed'
  | 'app.ready'
  | 'app.quit';

// ============================================================
// Iframe Panel — postMessage API
// ============================================================

/**
 * Messages your panel HTML can receive from the host via window.addEventListener('message', ...)
 */
export interface PanelHostMessage {
  type: 'claudia:init';
  /** Query params passed to the iframe URL */
  panelId: string;
  pluginId: string;
  projectRoot?: string;
  projectId?: string;
  /** Full local server base URL, e.g. "http://127.0.0.1:3100" */
  serverUrl: string;
}

/**
 * Messages your panel HTML can send to the host via window.parent.postMessage(msg, '*')
 */
export type PanelClientMessage =
  | { type: 'claudia:show-notification'; message: string }
  | { type: 'claudia:resize'; height: number };
