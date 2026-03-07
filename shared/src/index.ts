// Shared types for MyClaudia

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

export type ProviderType = 'claude' | 'opencode' | 'codex' | 'cursor';

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

export interface GitWorktree {
  path: string;      // 绝对路径
  branch: string;    // 分支名
  isMain: boolean;   // 是否是主 worktree
  commit?: string;   // HEAD commit hash（短）
}
export type SlashCommandScope = 'global' | 'project';

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
  agentPermissionOverride?: Partial<AgentPermissionPolicy>;  // Project-level override of global agent policy
  isInternal?: boolean;  // Internal projects (e.g. Agent Assistant) are hidden from user-facing lists
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

export type SessionType = 'regular' | 'background';

export interface Session {
  id: string;
  projectId: string;
  name?: string;
  providerId?: string;
  sdkSessionId?: string;
  type: SessionType;                // 'regular' = user-facing, 'background' = autonomous task
  parentSessionId?: string;          // Which session spawned this one (for background sessions)
  workingDirectory?: string;         // Session-specific working directory (e.g., for git worktree)
  createdAt: number;
  updatedAt: number;
  isActive?: boolean;  // Whether this session has an active AI request running
  archivedAt?: number; // Timestamp when session was archived, undefined = not archived
}

// ============================================
// Supervision Types
// ============================================

export type SupervisionStatus = 'planning' | 'active' | 'paused' | 'completed' | 'failed' | 'cancelled';

export interface SupervisionSubtask {
  id: number;              // 从 1 开始的序号
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
  completedAt?: number;
  phase?: number;                  // 阶段分组 (1, 2, 3...)
  acceptanceCriteria?: string[];   // 该子任务的验收标准
}

export interface Supervision {
  id: string;
  sessionId: string;
  goal: string;
  subtasks?: SupervisionSubtask[];
  status: SupervisionStatus;
  maxIterations: number;
  currentIteration: number;
  cooldownSeconds: number;
  lastRunId?: string;
  errorMessage?: string;
  acceptanceCriteria?: string[];   // 整体目标验收标准
  planSessionId?: string;          // planning 对话的 session ID
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

export interface SupervisionPlan {
  goal: string;
  subtasks: Array<{
    description: string;
    phase?: number;
    acceptanceCriteria?: string[];
  }>;
  acceptanceCriteria?: string[];
  estimatedIterations?: number;
}

export type SupervisionLogEvent =
  | 'planning_started' | 'planning_approved' | 'planning_cancelled'
  | 'iteration_started' | 'iteration_completed' | 'iteration_failed'
  | 'subtask_completed' | 'goal_completed'
  | 'paused' | 'resumed' | 'cancelled';

export interface SupervisionLog {
  id: string;
  supervisionId: string;
  iteration?: number;
  event: SupervisionLogEvent;
  detail?: Record<string, unknown>;
  createdAt: number;
}

export interface SupervisionUpdateMessage {
  type: 'supervision_update';
  supervision: Supervision;
  log?: SupervisionLog;
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
  offset?: number;  // Per-session sequential message number (for gap detection)
}

export type ContentBlock =
  | { type: 'text'; content: string }
  | { type: 'tool_use'; toolUseId: string };

export interface MessageMetadata {
  toolCalls?: ToolCall[];
  contentBlocks?: ContentBlock[];
  usage?: UsageInfo;
  filePush?: FilePushMetadata;
}

export interface FilePushMetadata {
  fileId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  description?: string;
  autoDownload: boolean;
}

export interface ToolCall {
  toolUseId?: string;
  name: string;
  input: unknown;
  output?: unknown;
  isError?: boolean;
}

export interface UsageInfo {
  inputTokens: number;
  outputTokens: number;
  contextWindow?: number;
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
  /** What to do when the timeout expires. Defaults to 'deny'. */
  timeoutBehavior?: 'approve' | 'deny';
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
  | AskUserAnswerMessage
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
  | GetProviderCommandsMessage
  | TerminalOpenMessage
  | TerminalInputMessage
  | TerminalResizeMessage
  | TerminalCloseMessage
  | PluginPermissionResponseMessage;

// Authentication message (sent after WebSocket connection)
export interface AuthMessage {
  type: 'auth';
}

// Permission modes supported by Claude SDK
export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions' | 'plan';

// ============================================
// Provider Capabilities (drives UI selectors)
// ============================================

/** A selectable option in the Mode dropdown (permission mode, agent, etc.) */
export interface ModeOption {
  id: string;           // Value sent to server (e.g. 'default', 'plan', 'build')
  label: string;        // Display text (e.g. 'Default', 'Plan')
  description?: string; // Tooltip / subtitle
  icon?: string;        // Emoji or icon identifier
}

/** A selectable option in the Model dropdown */
export interface ModelOption {
  id: string;           // Value sent to server (e.g. 'claude-sonnet-4-5-20250929')
  label: string;        // Display text (e.g. 'Sonnet')
  group?: string;       // Optional grouping (e.g. provider name in OpenCode)
}

/** What a provider supports — drives the UI selectors */
export interface ProviderCapabilities {
  modes: ModeOption[];    // Empty array → hide mode selector entirely
  models: ModelOption[];  // Empty array → hide model selector entirely
  modeLabel?: string;     // Custom label: "Mode" (Claude) / "Agent" (OpenCode)
  modelLabel?: string;    // Custom label: "Model" for all
  defaultModeId?: string; // Which mode is selected by default
}

export interface RunStartMessage {
  type: 'run_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  providerId?: string;
  permissionMode?: PermissionMode;  // Kept for backwards compat
  mode?: string;  // Generic mode/agent ID (new unified field)
  model?: string;  // Optional: override model (e.g. 'claude-sonnet-4-5-20250929')
  permissionOverride?: Partial<AgentPermissionPolicy>;  // Optional: session-level permission override
  systemContext?: string;  // Dynamic context prepended to system prompt (e.g. backend list for global agent)
  workingDirectory?: string;  // Optional: override working directory (e.g., for git worktree)
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
  /** RSA-OAEP encrypted credential (base64). Used for sudo password etc. */
  encryptedCredential?: string;
}

// AskUserQuestion answer (Client → Server)
export interface AskUserAnswerMessage {
  type: 'ask_user_answer';
  requestId: string;
  formattedAnswer: string;  // Pre-formatted readable text for Claude
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

// Remote Terminal messages (Client → Server)
export interface TerminalOpenMessage {
  type: 'terminal_open';
  terminalId: string;
  projectId: string;
  cols: number;
  rows: number;
}

export interface TerminalInputMessage {
  type: 'terminal_input';
  terminalId: string;
  data: string;
}

export interface TerminalResizeMessage {
  type: 'terminal_resize';
  terminalId: string;
  cols: number;
  rows: number;
}

export interface TerminalCloseMessage {
  type: 'terminal_close';
  terminalId: string;
}

// Plugin permission response (Client → Server)
export interface PluginPermissionResponseMessage {
  type: 'plugin_permission_response';
  pluginId: string;
  granted: boolean;
  permanently?: boolean;
}

// Remote Terminal messages (Server → Client)
export interface TerminalOpenedMessage {
  type: 'terminal_opened';
  terminalId: string;
  success: boolean;
  error?: string;
}

export interface TerminalOutputMessage {
  type: 'terminal_output';
  terminalId: string;
  data: string;
}

export interface TerminalExitedMessage {
  type: 'terminal_exited';
  terminalId: string;
  exitCode: number;
}

// File Push notification (Server → Client)
export interface FilePushNotificationMessage {
  type: 'file_push';
  fileId: string;
  sessionId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  description?: string;
  autoDownload: boolean;
  messageId?: string;
}

// Plugin state (Server → Client)
export interface PluginStateMessage {
  type: 'plugin_state';
  plugins: Array<{
    id: string;
    name: string;
    version: string;
    description: string;
    status: 'active' | 'inactive' | 'error';
    enabled: boolean;
    error?: string;
    permissions?: string[];
    grantedPermissions?: string[];
    tools?: string[];
    commands?: string[];
    path: string;
  }>;
}

// Plugin permission request (Server → Client)
export interface PluginPermissionRequestMessage {
  type: 'plugin_permission_request';
  pluginId: string;
  pluginName: string;
  permissions: string[];
}

// Plugin notification (Server → Client)
export interface PluginNotificationMessage {
  type: 'plugin_notification';
  pluginId: string;
  title: string;
  body: string;
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
  | ModeChangeMessage
  | RunCompletedMessage
  | RunFailedMessage
  | PermissionRequestMessage
  | AskUserQuestionMessage
  | AgentPermissionInterceptedMessage
  | BackgroundTaskUpdateMessage
  | BackgroundPermissionPendingMessage
  | TaskNotificationMessage
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
  | ProvidersDeletedMessage
  | SupervisionUpdateMessage
  | PermissionResolvedMessage
  | PermissionAutoResolvedMessage
  | AskUserQuestionResolvedMessage
  | StateHeartbeatMessage
  | TerminalOpenedMessage
  | TerminalOutputMessage
  | TerminalExitedMessage
  | FilePushNotificationMessage
  | PluginStateMessage
  | PluginPermissionRequestMessage
  | PluginNotificationMessage;

// Authentication result message
export interface AuthResultMessage {
  type: 'auth_result';
  success: boolean;
  error?: string;
  isLocalConnection?: boolean;  // Whether the connection is from localhost
  serverVersion?: string;       // Server version string
  features?: ServerFeature[];   // Server-advertised feature flags
  /** PEM-encoded RSA-OAEP public key for E2E credential encryption */
  publicKey?: string;
}

export interface RunStartedMessage {
  type: 'run_started';
  runId: string;
  sessionId: string;
  clientRequestId: string;
  /** Real DB message ID for the user message (for client-side dedup) */
  userMessageId?: string;
  /** Real DB message ID for the assistant message (for client-side dedup) */
  assistantMessageId?: string;
  /** Session type — background runs should not affect the session's loading state */
  sessionType?: 'regular' | 'background';
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
  mcpServers?: { name: string; status: string }[];
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
  sessionId: string;
  content: string;
}

export interface ToolUseMessage {
  type: 'tool_use';
  runId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
}

export interface ToolResultMessage {
  type: 'tool_result';
  runId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
}

export interface ModeChangeMessage {
  type: 'mode_change';
  runId: string;
  sessionId: string;
  mode: string;
}

export interface RunCompletedMessage {
  type: 'run_completed';
  runId: string;
  sessionId: string;
  usage?: UsageInfo;
}

export interface RunFailedMessage {
  type: 'run_failed';
  runId: string;
  sessionId: string;
  error: string;
}

export interface PermissionRequestMessage {
  type: 'permission_request';
  requestId: string;
  sessionId: string;
  toolName: string;
  detail: string;
  timeoutSeconds: number;
  /** When true, the UI should show a password input for credential (e.g. sudo). */
  requiresCredential?: boolean;
  /** Hint for what kind of credential is needed (e.g. 'sudo_password'). */
  credentialHint?: string;
  /** When true, timeout will auto-approve (not deny); show countdown accordingly. */
  aiInitiated?: boolean;
}

// AskUserQuestion: interactive question UI (Server → Client)
export interface AskUserQuestionOption {
  label: string;
  description: string;
}

export interface AskUserQuestionItem {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionMessage {
  type: 'ask_user_question';
  requestId: string;
  sessionId: string;
  questions: AskUserQuestionItem[];
}

// Agent permission auto-approval notification (Server → Client)
export interface AgentPermissionInterceptedMessage {
  type: 'agent_permission_intercepted';
  toolName: string;
  decision: 'approve' | 'deny';
  reason: string;
  sessionId: string;     // The session whose permission was intercepted
  runId: string;
}

// Background task status update (Server → Client)
export type BackgroundTaskStatus = 'running' | 'paused' | 'completed' | 'failed';

export interface BackgroundTaskUpdateMessage {
  type: 'background_task_update';
  sessionId: string;
  parentSessionId?: string;
  status: BackgroundTaskStatus;
  name?: string;
  reason?: string;       // e.g. 'Permission escalated', 'Completed successfully'
}

// SDK task notification (e.g. background Bash process exited) (Server → Client)
export interface TaskNotificationMessage {
  type: 'task_notification';
  runId: string;
  sessionId: string;
  taskId?: string;
  status?: string;
  message?: string;
}

// Background session has a pending permission that needs user attention (Server → Client)
export interface BackgroundPermissionPendingMessage {
  type: 'background_permission_pending';
  sessionId: string;     // The background session
  requestId: string;     // Permission request ID (use with permission_decision to resolve)
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
// Server Feature Negotiation
// ============================================

/** Features a server can advertise. Frontend uses these to decide
 *  whether to call certain API endpoints or show certain UI. */
export type ServerFeature =
  | 'providerCapabilities'   // GET /api/providers/:id/capabilities, /type/:type/capabilities
  | 'providerCommands'       // GET /api/providers/:id/commands, /type/:type/commands
  | 'setDefaultProvider'     // POST /api/providers/:id/set-default
  | 'search'                 // GET /api/sessions/search/*
  | 'fileUpload'             // POST /api/files/upload
  | 'remoteTerminal'         // WebSocket-based PTY terminal
  | 'filePush'               // POST /api/files/push — server-to-client file delivery
  ;

/** All features supported by the current server version. */
export const ALL_SERVER_FEATURES: ServerFeature[] = [
  'providerCapabilities',
  'providerCommands',
  'setDefaultProvider',
  'search',
  'fileUpload',
  'remoteTerminal',
  'filePush',
];

// ============================================
// Server Info Types
// ============================================

export interface SdkVersionInfo {
  name: string;
  current: string;
  latest: string;
  outdated: boolean;
}

export interface SdkVersionReport {
  checkedAt: number;
  sdks: SdkVersionInfo[];
}

export interface ServerInfo {
  version: string;
  isLocalConnection: boolean;  // Whether the client is connecting from localhost (determined by server)
  features?: ServerFeature[];  // Server-advertised feature flags
  /** PEM-encoded RSA-OAEP public key for E2E credential encryption */
  publicKey?: string;
  /** SDK version check results (populated asynchronously after server startup) */
  sdkVersions?: SdkVersionReport;
}

// ============================================
// Gateway Protocol Types
// ============================================

// Backend info (returned in list_backends)
export interface GatewayBackendInfo {
  backendId: string;
  name: string;
  online: boolean;
  isLocal?: boolean;
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
  features?: ServerFeature[];   // Backend-advertised feature flags
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
  backends?: GatewayBackendInfo[];  // Included on success for immediate discovery
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
  features?: ServerFeature[];   // Backend-advertised feature flags (passthrough)
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
  message: ServerMessage | BackendSessionsListMessage | BackendSessionEventMessage;
}

export interface GatewayErrorMessage {
  type: 'gateway_error';
  code: string;
  message: string;
  backendId?: string;
}

// --- Session Sync Protocol (Backend → Client via Gateway) ---

// Backend sends full session list to a newly subscribed client
export interface BackendSessionsListMessage {
  type: 'backend_sessions_list';
  backendId: string;
  sessions: Array<{
    id: string;
    projectId: string;
    name?: string;
    providerId?: string;
    type?: SessionType;
    parentSessionId?: string;
    createdAt: number;
    updatedAt: number;
    isActive: boolean;  // Whether there's an active run for this session
    lastMessageOffset?: number;  // Max message offset in this session (for gap detection)
  }>;
}

// Backend broadcasts session event to all subscribed clients
export interface BackendSessionEventMessage {
  type: 'backend_session_event';
  backendId: string;
  eventType: 'created' | 'updated' | 'deleted';
  session: {
    id: string;
    projectId: string;
    name?: string;
    providerId?: string;
    type?: SessionType;
    parentSessionId?: string;
    createdAt: number;
    updatedAt: number;
    isActive?: boolean;
    lastMessageOffset?: number;
  };
}

// Backend → Gateway: request to broadcast session event to all subscribers
export interface GatewayBroadcastSessionEventMessage {
  type: 'broadcast_session_event';
  eventType: 'created' | 'updated' | 'deleted';
  session: Session;
}

// Gateway → Backend: notification that a client has subscribed
export interface GatewayClientSubscribedMessage {
  type: 'client_subscribed';
  clientId: string;
}

// Backend → Gateway: broadcast message to all subscribers
export interface GatewayBroadcastToSubscribersMessage {
  type: 'broadcast_to_subscribers';
  message: ServerMessage | BackendSessionsListMessage | BackendSessionEventMessage;
}

// Client → Gateway: update subscription preferences
export interface GatewayUpdateSubscriptionsMessage {
  type: 'update_subscriptions';
  subscribedBackendIds: string[];
  subscribeAll?: boolean;
}

// Gateway → Client: confirm subscription state
export interface GatewaySubscriptionAckMessage {
  type: 'subscription_ack';
  subscribedBackendIds: string[];
}

// Server → Client: a permission request has been resolved by another device
export interface PermissionResolvedMessage {
  type: 'permission_resolved';
  requestId: string;
  sessionId?: string;
  decision: 'allow' | 'deny';
}

// Server → Client: a permission request was auto-resolved by backend timer
export interface PermissionAutoResolvedMessage {
  type: 'permission_auto_resolved';
  requestId: string;
  sessionId: string;
  /** Whether the backend approved or denied on timeout expiry. */
  behavior: 'approve' | 'deny';
}

// Server → Client: an ask_user_question has been resolved by another device
export interface AskUserQuestionResolvedMessage {
  type: 'ask_user_question_resolved';
  requestId: string;
  sessionId?: string;
}

// Run health status for stuck/loop detection
export type RunHealthStatus = 'healthy' | 'idle' | 'loop';

// Server → Client: state heartbeat for reconciliation
export interface StateHeartbeatMessage {
  type: 'state_heartbeat';
  activeRuns: Array<{
    runId: string;
    sessionId: string;
    startedAt: number;
    lastActivityAt: number;
    health: RunHealthStatus;
    loopPattern?: string;
    /** Session type — background runs should not affect the session's loading state */
    sessionType?: 'regular' | 'background';
    /** Latest init/system metadata for this run (if available). */
    systemInfo?: SystemInfo;
  }>;
  pendingPermissions: Array<{
    requestId: string;
    sessionId: string;
    toolName: string;
    detail: string;
    timeoutSeconds: number;
    requiresCredential?: boolean;
    credentialHint?: string;
    aiInitiated?: boolean;
  }>;
  pendingQuestions: Array<{
    requestId: string;
    sessionId: string;
    questions: AskUserQuestionItem[];
  }>;
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

// Streaming HTTP proxy response (for large/binary payloads)
// Flow: response_start → N × response_chunk → response_end

export interface GatewayHttpProxyResponseStart {
  type: 'http_proxy_response_start';
  requestId: string;
  statusCode: number;
  headers: Record<string, string>;
}

export interface GatewayHttpProxyResponseChunk {
  type: 'http_proxy_response_chunk';
  requestId: string;
  data: string;          // base64-encoded binary chunk
}

export interface GatewayHttpProxyResponseEnd {
  type: 'http_proxy_response_end';
  requestId: string;
}

// Union types for Gateway messages
export type GatewayToBackendMessage =
  | GatewayRegisterResultMessage
  | GatewayBackendsListMessage
  | GatewayClientAuthMessage
  | GatewayForwardedMessage
  | GatewayClientConnectedMessage
  | GatewayClientDisconnectedMessage
  | GatewayClientSubscribedMessage
  | GatewayHttpProxyRequest;

export type BackendToGatewayMessage =
  | GatewayRegisterMessage
  | GatewayClientAuthResultMessage
  | GatewayBackendResponseMessage
  | GatewayBroadcastSessionEventMessage
  | GatewayBroadcastToSubscribersMessage
  | GatewayHttpProxyResponse
  | GatewayHttpProxyResponseStart
  | GatewayHttpProxyResponseChunk
  | GatewayHttpProxyResponseEnd;

export type ClientToGatewayMessage =
  | GatewayAuthMessage
  | GatewayListBackendsMessage
  | GatewayConnectBackendMessage
  | GatewaySendToBackendMessage
  | GatewayUpdateSubscriptionsMessage;

export type GatewayToClientMessage =
  | GatewayAuthResultMessage
  | GatewayBackendsListMessage
  | GatewayBackendAuthResultMessage
  | GatewayBackendDisconnectedMessage
  | GatewayBackendMessageMessage
  | GatewayErrorMessage
  | GatewaySubscriptionAckMessage;

// ============================================
// Agent Assistant Types
// ============================================

export interface AgentPermissionPolicy {
  enabled: boolean;
  trustLevel: 'conservative' | 'moderate' | 'aggressive' | 'full_trust';

  customRules: AgentPermissionRule[];
  escalateAlways: string[];     // tool names that always go to user

  /** @deprecated Strategies are now built into trust levels. Kept for backward compat parsing. */
  strategies?: unknown;
}

export interface AgentPermissionRule {
  toolName: string;      // exact match or '*'
  pattern?: string;      // optional regex on detail
  action: 'approve' | 'deny' | 'escalate' | 'continue';
}

/** Context passed to the permission evaluator for path-aware strategies */
export interface EvaluationContext {
  rootPath: string;              // Session's workspace root directory
  sessionType: SessionType;      // 'regular' or 'background'
}

/** Default sensitive file patterns */
export const DEFAULT_SENSITIVE_PATTERNS = [
  '.env*',
  '*credential*',
  '*.pem',
  '*.key',
  'id_rsa*',
  '*.p12',
  '*.pfx',
  '*secret*',
];

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

// ============================================
// Push Notification Types (ntfy integration)
// ============================================

export interface NotificationEventPreferences {
  permissionRequest: boolean;
  askUserQuestion: boolean;
  runCompleted: boolean;
  runFailed: boolean;
  supervisionUpdate: boolean;
  backgroundPermission: boolean;
}

export interface NotificationConfig {
  enabled: boolean;
  ntfyUrl: string;
  ntfyTopic: string;
  events: NotificationEventPreferences;
}

export const DEFAULT_NOTIFICATION_CONFIG: NotificationConfig = {
  enabled: false,
  ntfyUrl: 'https://ntfy.sh',
  ntfyTopic: '',
  events: {
    permissionRequest: true,
    askUserQuestion: true,
    runCompleted: true,
    runFailed: true,
    supervisionUpdate: true,
    backgroundPermission: true,
  },
};

// ============================================
// Plugin Platform Types
// ============================================

export * from './plugin-types.js';
