// Shared types for My Claudia

// ============================================
// Request-Response Correlation Protocol
// ============================================

export * from './protocol/correlation.js';

// ============================================
// Backend Server Types (for multi-machine support)
// ============================================

export interface BackendServer {
  id: string;
  name: string;           // "家里的 Mac"、"公司 Mac"
  address: string;        // "192.168.1.100:3100" 或 "mac-home.local:3100"
  isDefault: boolean;
  lastConnected?: number; // 上次连接时间
  createdAt: number;
  clientId?: string;      // Optional client ID for multi-backend direct connections
  // Legacy fields (kept for backward compatibility with existing DB entries)
  connectionMode?: 'direct' | 'gateway';
}

// ============================================
// Provider Types
// ============================================

export type ProviderType = 'claude' | 'cursor' | 'codex' | 'openrouter' | 'glm' | 'custom';

export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  cliPath?: string;
  env?: Record<string, string>;
  isDefault?: boolean;
  createdAt: number;
  updatedAt: number;
}

// ============================================
// Slash Command Types
// ============================================

export type SlashCommandSource = 'local' | 'provider' | 'custom' | 'plugin';
export type SlashCommandScope = 'global' | 'project';

export interface SlashCommand {
  command: string;        // e.g., '/cost', '/clear', '/project:my-command', '/commit-commands:commit'
  description: string;    // Displayed in autocomplete
  source: SlashCommandSource;  // 'local' = frontend, 'provider' = built-in, 'custom' = user-defined, 'plugin' = CLI plugin
  scope?: SlashCommandScope;   // For custom commands: 'global' (~/.claude) or 'project' (.claude)
  filePath?: string;      // For custom/plugin commands: path to the .md file
}

// Commands supported by each provider type
export const PROVIDER_COMMANDS: Record<ProviderType, SlashCommand[]> = {
  claude: [
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
  ],
  cursor: [
    // Cursor-specific commands can be added here
  ],
  codex: [
    // Codex-specific commands can be added here
  ],
  openrouter: [
    // OpenRouter typically doesn't have CLI commands
  ],
  glm: [
    // GLM-specific commands can be added here
  ],
  custom: [
    // Custom providers may define their own commands
  ],
};

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
];

// CLI pass-through commands (sent directly to Claude SDK)
// Note: /compact and /context were removed because they don't produce output through SDK
// Users should use these commands directly in Claude CLI if needed
export const CLI_COMMANDS: SlashCommand[] = [];

// ============================================
// Project Types
// ============================================

export type ProjectType = 'chat_only' | 'code';

export interface Project {
  id: string;
  name: string;
  type: ProjectType;
  providerId?: string;
  rootPath?: string;
  systemPrompt?: string;
  permissionPolicy?: PermissionPolicy;
  createdAt: number;
  updatedAt: number;
}

export interface PermissionPolicy {
  allowedTools: string[];
  disallowedTools: string[];
  autoApprove: boolean;
  timeoutSeconds: number;
}

// ============================================
// Session Types
// ============================================

export interface Session {
  id: string;
  projectId: string;
  name?: string;
  providerId?: string;
  sdkSessionId?: string;
  createdAt: number;
  updatedAt: number;
}

// ============================================
// Message Types
// ============================================

export type MessageRole = 'user' | 'assistant' | 'system';

// File attachment reference (uses fileId instead of embedded base64)
export interface MessageAttachment {
  fileId: string;        // Reference to uploaded file
  name: string;          // Original filename
  mimeType: string;      // MIME type
  type: 'image' | 'file'; // Attachment type
}

// Structured message input (for messages with attachments)
export interface MessageInput {
  text: string;
  attachments?: MessageAttachment[];
}

export interface Message {
  id: string;
  sessionId: string;
  role: MessageRole;
  content: string;
  metadata?: MessageMetadata;
  createdAt: number;
}

export interface MessageMetadata {
  toolCalls?: ToolCall[];
  usage?: UsageInfo;
}

export interface ToolCall {
  name: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
}

// ============================================
// Permission Types
// ============================================

export type PermissionDecision = 'allow' | 'deny' | 'timeout';

export interface PermissionLog {
  id: string;
  sessionId: string;
  tool: string;
  detail: string;
  decision: PermissionDecision;
  remembered: boolean;
  createdAt: number;
}

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  toolInput: unknown;
  detail: string;
  timeoutSeconds: number;
}

// ============================================
// WebSocket Protocol Types
// ============================================

// Client → Server messages
export type ClientMessage =
  | AuthMessage
  | RunStartMessage
  | RunCancelMessage
  | PermissionDecisionMessage
  | PingMessage
  | GetProjectsMessage
  | GetSessionsMessage
  | GetServersMessage
  | AddServerMessage
  | UpdateServerMessage
  | DeleteServerMessage
  | AddSessionMessage
  | UpdateSessionMessage
  | DeleteSessionMessage
  | AddProjectMessage
  | UpdateProjectMessage
  | DeleteProjectMessage
  | GetProvidersMessage
  | AddProviderMessage
  | UpdateProviderMessage
  | DeleteProviderMessage
  | GetSessionMessagesMessage
  | GetProviderCommandsMessage;

// Authentication message (sent after WebSocket connection)
export interface AuthMessage {
  type: 'auth';
}

// Permission modes supported by Claude SDK
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

export interface RunStartMessage {
  type: 'run_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  providerId?: string;
  permissionMode?: PermissionMode;  // Optional: defaults to 'default'
  model?: string;  // Optional: override model (e.g. 'claude-sonnet-4-5-20250929')
}

export interface RunCancelMessage {
  type: 'run_cancel';
  runId: string;
}

export interface PermissionDecisionMessage {
  type: 'permission_decision';
  requestId: string;
  allow: boolean;
  remember?: boolean;
}

export interface PingMessage {
  type: 'ping';
}

export interface GetProjectsMessage {
  type: 'get_projects';
}

export interface GetSessionsMessage {
  type: 'get_sessions';
}

export interface GetServersMessage {
  type: 'get_servers';
}

export interface AddServerMessage {
  type: 'add_server';
  server: Omit<BackendServer, 'id' | 'createdAt' | 'lastConnected'>;
}

export interface UpdateServerMessage {
  type: 'update_server';
  id: string;
  server: Partial<Omit<BackendServer, 'id' | 'createdAt'>>;
}

export interface DeleteServerMessage {
  type: 'delete_server';
  id: string;
}

export interface AddSessionMessage {
  type: 'add_session';
  session: Omit<Session, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface UpdateSessionMessage {
  type: 'update_session';
  id: string;
  session: Partial<Omit<Session, 'id' | 'createdAt' | 'updatedAt'>>;
}

export interface DeleteSessionMessage {
  type: 'delete_session';
  id: string;
}

export interface AddProjectMessage {
  type: 'add_project';
  project: Omit<Project, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface UpdateProjectMessage {
  type: 'update_project';
  id: string;
  project: Partial<Omit<Project, 'id' | 'createdAt' | 'updatedAt'>>;
}

export interface DeleteProjectMessage {
  type: 'delete_project';
  id: string;
}

export interface GetProvidersMessage {
  type: 'get_providers';
}

export interface AddProviderMessage {
  type: 'add_provider';
  provider: Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>;
}

export interface UpdateProviderMessage {
  type: 'update_provider';
  id: string;
  provider: Partial<Omit<ProviderConfig, 'id' | 'createdAt' | 'updatedAt'>>;
}

export interface DeleteProviderMessage {
  type: 'delete_provider';
  id: string;
}

export interface GetSessionMessagesMessage {
  type: 'get_session_messages';
  sessionId: string;
  limit?: number;
  before?: number;  // timestamp
}

export interface GetProviderCommandsMessage {
  type: 'get_provider_commands';
  providerId: string;
  projectRoot?: string;
}

// Server → Client messages
export type ServerMessage =
  | AuthResultMessage
  | RunStartedMessage
  | SessionCreatedMessage
  | SystemInfoMessage
  | DeltaMessage
  | ToolUseMessage
  | ToolResultMessage
  | RunCompletedMessage
  | RunFailedMessage
  | PermissionRequestMessage
  | PongMessage
  | ErrorMessage
  | ProjectsListMessage
  | SessionsListMessage
  | ServersListMessage
  | ServerOperationResultMessage
  | SessionOperationResultMessage
  | ProjectOperationResultMessage
  | ProvidersListMessage
  | ProviderOperationResultMessage
  | SessionMessagesMessage
  | ProviderCommandsMessage
  | ServersCreatedMessage
  | ServersUpdatedMessage
  | ServersDeletedMessage
  | SessionsCreatedMessage
  | SessionsUpdatedMessage
  | SessionsDeletedMessage
  | ProjectsCreatedMessage
  | ProjectsUpdatedMessage
  | ProjectsDeletedMessage
  | ProvidersCreatedMessage
  | ProvidersUpdatedMessage
  | ProvidersDeletedMessage;

// Authentication result message
export interface AuthResultMessage {
  type: 'auth_result';
  success: boolean;
  error?: string;
  isLocalConnection?: boolean;  // Whether the connection is from localhost
}

export interface RunStartedMessage {
  type: 'run_started';
  runId: string;
  clientRequestId: string;
}

export interface SessionCreatedMessage {
  type: 'session_created';
  sessionId: string;
  sdkSessionId?: string;
}

// System info from Claude SDK init message
export interface SystemInfo {
  model?: string;
  claudeCodeVersion?: string;
  cwd?: string;
  permissionMode?: string;
  apiKeySource?: string;
  tools?: string[];
  mcpServers?: string[];
  slashCommands?: string[];
  agents?: string[];
}

export interface SystemInfoMessage {
  type: 'system_info';
  runId: string;
  systemInfo: SystemInfo;
}

export interface DeltaMessage {
  type: 'delta';
  runId: string;
  content: string;
}

export interface ToolUseMessage {
  type: 'tool_use';
  runId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
}

export interface ToolResultMessage {
  type: 'tool_result';
  runId: string;
  toolUseId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export interface RunCompletedMessage {
  type: 'run_completed';
  runId: string;
  usage?: UsageInfo;
}

export interface RunFailedMessage {
  type: 'run_failed';
  runId: string;
  error: string;
}

export interface PermissionRequestMessage {
  type: 'permission_request';
  requestId: string;
  toolName: string;
  detail: string;
  timeoutSeconds: number;
}

export interface PongMessage {
  type: 'pong';
}

export interface ErrorMessage {
  type: 'error';
  code: string;
  message: string;
}

export interface ProjectsListMessage {
  type: 'projects_list';
  projects: Project[];
}

export interface SessionsListMessage {
  type: 'sessions_list';
  sessions: Session[];
}

export interface ServersListMessage {
  type: 'servers_list';
  servers: BackendServer[];
}

export interface ServerOperationResultMessage {
  type: 'server_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  serverId?: string;
  error?: string;
}

export interface SessionOperationResultMessage {
  type: 'session_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  session?: Session;
  error?: string;
}

export interface ProjectOperationResultMessage {
  type: 'project_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  project?: Project;
  error?: string;
}

export interface SessionMessagesMessage {
  type: 'session_messages';
  sessionId: string;
  messages: Message[];
  hasMore: boolean;
}

export interface ProvidersListMessage {
  type: 'providers_list';
  providers: ProviderConfig[];
}

export interface ProviderOperationResultMessage {
  type: 'provider_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  provider?: ProviderConfig;
  error?: string;
}

// Router CRUD response messages (correlation envelope format)
export interface ServersCreatedMessage {
  type: 'servers_created';
  server: BackendServer;
}

export interface ServersUpdatedMessage {
  type: 'servers_updated';
  server: BackendServer;
}

export interface ServersDeletedMessage {
  type: 'servers_deleted';
  success: boolean;
  id: string;
}

export interface SessionsCreatedMessage {
  type: 'sessions_created';
  session: Session;
}

export interface SessionsUpdatedMessage {
  type: 'sessions_updated';
  session: Session;
}

export interface SessionsDeletedMessage {
  type: 'sessions_deleted';
  success: boolean;
  id: string;
}

export interface ProjectsCreatedMessage {
  type: 'projects_created';
  project: Project;
}

export interface ProjectsUpdatedMessage {
  type: 'projects_updated';
  project: Project;
}

export interface ProjectsDeletedMessage {
  type: 'projects_deleted';
  success: boolean;
  id: string;
}

export interface ProvidersCreatedMessage {
  type: 'providers_created';
  provider: ProviderConfig;
}

export interface ProvidersUpdatedMessage {
  type: 'providers_updated';
  provider: ProviderConfig;
}

export interface ProvidersDeletedMessage {
  type: 'providers_deleted';
  success: boolean;
  id: string;
}

export interface ProviderCommandsMessage {
  type: 'provider_commands';
  providerId: string;
  commands: SlashCommand[];
}

// ============================================
// API Response Types
// ============================================

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

// ============================================
// File Browser Types (@ mention support)
// ============================================

export type FileEntryType = 'file' | 'directory';

export interface FileEntry {
  name: string;           // e.g., "MessageInput.tsx"
  path: string;           // relative path from project root, e.g., "src/components/chat/MessageInput.tsx"
  type: FileEntryType;
  extension?: string;     // e.g., ".tsx", ".ts", ".md" (only for files)
  size?: number;          // file size in bytes (only for files)
}

export interface DirectoryListingRequest {
  projectRoot: string;    // absolute path to project root
  relativePath?: string;  // path relative to project root (default: "")
  query?: string;         // filter query (fuzzy match)
  maxResults?: number;    // limit results (default: 50)
}

export interface DirectoryListingResponse {
  entries: FileEntry[];
  currentPath: string;    // the resolved relative path
  hasMore: boolean;       // whether there are more results
}

export interface FileContentResponse {
  path: string;           // relative path from project root
  content: string;        // file content
  size: number;           // file size in bytes
}

// ============================================
// Command Execution Types
// ============================================

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

// ============================================
// Server Info Types
// ============================================

export interface ServerInfo {
  version: string;
  isLocalConnection: boolean;  // Whether the client is connecting from localhost (determined by server)
}

// ============================================
// Gateway Protocol Types
// ============================================

// Backend info (returned in list_backends)
export interface GatewayBackendInfo {
  backendId: string;
  name: string;
  online: boolean;
}

// --- Gateway Messages (Backend → Gateway) ---

export interface GatewayRegisterMessage {
  type: 'register';
  gatewaySecret: string;
  deviceId: string;
  name?: string;
  visible?: boolean;  // Default true. If false, connects to gateway but is not listed as available backend
}

export interface GatewayRegisterResultMessage {
  type: 'register_result';
  success: boolean;
  backendId?: string;
  error?: string;
}

// Client auth forwarded to backend
export interface GatewayClientAuthMessage {
  type: 'client_auth';
  clientId: string;
}

// Backend's response to client auth
export interface GatewayClientAuthResultMessage {
  type: 'client_auth_result';
  clientId: string;
  success: boolean;
  error?: string;
}

// Wrapper for forwarded messages from client to backend
export interface GatewayForwardedMessage {
  type: 'forwarded';
  clientId: string;
  message: ClientMessage;
}

// Wrapper for messages from backend to client
export interface GatewayBackendResponseMessage {
  type: 'backend_response';
  clientId: string;
  message: ServerMessage;
}

// Client connected/disconnected notifications to backend
export interface GatewayClientConnectedMessage {
  type: 'client_connected';
  clientId: string;
}

export interface GatewayClientDisconnectedMessage {
  type: 'client_disconnected';
  clientId: string;
}

// --- Gateway Messages (Client → Gateway) ---

export interface GatewayAuthMessage {
  type: 'gateway_auth';
  gatewaySecret: string;
}

export interface GatewayAuthResultMessage {
  type: 'gateway_auth_result';
  success: boolean;
  error?: string;
}

export interface GatewayListBackendsMessage {
  type: 'list_backends';
}

export interface GatewayBackendsListMessage {
  type: 'backends_list';
  backends: GatewayBackendInfo[];
}

export interface GatewayConnectBackendMessage {
  type: 'connect_backend';
  backendId: string;
}

export interface GatewayBackendAuthResultMessage {
  type: 'backend_auth_result';
  backendId: string;
  success: boolean;
  error?: string;
}

export interface GatewayBackendDisconnectedMessage {
  type: 'backend_disconnected';
  backendId: string;
}

// Client sends messages to a specific backend
export interface GatewaySendToBackendMessage {
  type: 'send_to_backend';
  backendId: string;
  message: ClientMessage;
}

// Gateway forwards backend messages to client
export interface GatewayBackendMessageMessage {
  type: 'backend_message';
  backendId: string;
  message: ServerMessage;
}

export interface GatewayErrorMessage {
  type: 'gateway_error';
  code: string;
  message: string;
  backendId?: string;
}

// --- Gateway HTTP Proxy Protocol ---
// Used when clients connect through Gateway and need to make REST API calls
// to a backend that may be behind NAT.
// Flow: Client → HTTP → Gateway → WS → Backend → WS → Gateway → HTTP → Client

export interface GatewayHttpProxyRequest {
  type: 'http_proxy_request';
  requestId: string;
  method: string;        // GET, POST, PUT, DELETE
  path: string;          // /api/projects, /api/sessions/xxx/messages
  headers: Record<string, string>;
  body?: string;         // JSON string
}

export interface GatewayHttpProxyResponse {
  type: 'http_proxy_response';
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;          // JSON string
}

// Union types for Gateway messages
export type GatewayToBackendMessage =
  | GatewayRegisterResultMessage
  | GatewayBackendsListMessage
  | GatewayClientAuthMessage
  | GatewayForwardedMessage
  | GatewayClientConnectedMessage
  | GatewayClientDisconnectedMessage
  | GatewayHttpProxyRequest;

export type BackendToGatewayMessage =
  | GatewayRegisterMessage
  | GatewayClientAuthResultMessage
  | GatewayBackendResponseMessage
  | GatewayHttpProxyResponse;

export type ClientToGatewayMessage =
  | GatewayAuthMessage
  | GatewayListBackendsMessage
  | GatewayConnectBackendMessage
  | GatewaySendToBackendMessage;

export type GatewayToClientMessage =
  | GatewayAuthResultMessage
  | GatewayBackendsListMessage
  | GatewayBackendAuthResultMessage
  | GatewayBackendDisconnectedMessage
  | GatewayBackendMessageMessage
  | GatewayErrorMessage;

// ============================================
// Server Gateway Configuration Types
// ============================================

export interface ServerGatewayConfig {
  id: number;
  enabled: boolean;
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  backendName: string | null;
  backendId: string | null;
  registerAsBackend?: boolean;
  proxyUrl?: string | null;
  proxyUsername?: string | null;
  proxyPassword?: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ServerGatewayStatus {
  enabled: boolean;
  connected: boolean;
  backendId: string | null;
  gatewayUrl: string | null;
  gatewaySecret: string | null;
  backendName: string | null;
  registerAsBackend: boolean;
  discoveredBackends: GatewayBackendInfo[];
}
