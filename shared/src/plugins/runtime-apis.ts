export type EventHandler = (data: unknown) => void | Promise<void>;

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
  list(): Promise<ProviderInfo[]>;
  get(providerId: string): Promise<ProviderInfo | undefined>;
  call(options: ProviderCallOptions): Promise<ProviderCallResult>;
  callStream(options: ProviderCallOptions): AsyncGenerator<ProviderStreamChunk>;
}

export interface McpServerInfo {
  name: string;
  enabled: boolean;
  description?: string;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpAPI {
  /** List all configured MCP servers */
  listServers(): Promise<McpServerInfo[]>;
  /** List tools available on a specific MCP server */
  listTools(serverName: string): Promise<McpToolInfo[]>;
  /** Call a tool on a specific MCP server */
  callTool<T = unknown>(serverName: string, tool: string, args: Record<string, unknown>): Promise<T>;
}

export interface PluginSchedulerTask {
  /** Unique task ID (scoped to plugin, e.g. 'poll-messages') */
  id: string;
  /** Human-readable name */
  name: string;
  /** Interval in milliseconds */
  intervalMs: number;
  /** Whether to run immediately on register (default: true) */
  immediate?: boolean;
}

export interface PluginSchedulerAPI {
  /** Register a periodic task. Returns a dispose function. */
  register(task: PluginSchedulerTask, handler: () => Promise<void> | void): () => void;
  /** Unregister a task by ID. */
  unregister(taskId: string): void;
  /** Trigger a task immediately (outside its schedule). */
  trigger(taskId: string): Promise<void>;
}
