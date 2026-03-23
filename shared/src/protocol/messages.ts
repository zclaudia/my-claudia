// WebSocket Protocol Message Types

import type { BackendServer, ServerFeature } from '../core/server.js';
import type { ProviderConfig, PermissionMode } from '../core/provider.js';
import type { Session, SessionType } from '../core/session.js';
import type { Message, UsageInfo } from '../core/message.js';
import type { Project } from '../core/project.js';
import type { AgentPermissionPolicy } from '../interaction/permissions.js';
import type { AskUserQuestionItem, AskUserInteractionMessage, TodoUpdateInteractionMessage, AskUserFormInteractionMessage, ApprovalInteractionMessage, InteractionResolvedMessage, InteractionResponseMessage } from '../interaction/forms.js';
import type { SupervisionTask, ProjectAgent, SupervisorConfig } from '../features/supervision.js';
import type { LocalPR } from '../features/local-pr.js';
import type { ScheduledTask } from '../features/scheduled-tasks.js';
import type { SystemTaskInfo } from '../features/system-tasks.js';
import type { SlashCommand } from '../features/commands.js';
import type { Workflow, WorkflowRun, WorkflowStepRun } from '../features/workflows.js';

// ============================================
// Client → Server messages
// ============================================

export type ClientMessage =
  | AuthMessage
  | RunStartMessage
  | RunCancelMessage
  | KillLeakedProcessesMessage
  | StopBackgroundTaskMessage
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
  | TerminalAttachMessage
  | TerminalDetachMessage
  | PluginPermissionResponseMessage
  // Supervision v2
  | GetSupervisionTasksMessage
  | AddSupervisionTaskMessage
  | UpdateSupervisionTaskMessage
  | InitSupervisionAgentMessage
  | UpdateSupervisionAgentMessage
  | ReloadSupervisionContextMessage
  | InteractionResponseMessage
  // Agent Assistant
  | AgentStartMessage
  | AgentCancelMessage
  // Claudia Tasks
  | ClaudiaTaskSubmitMessage
  | ClaudiaTaskContinueMessage
  | ClaudiaTaskCancelMessage
  | ClaudiaMessageMessage
  // Agent Feed
  | GetAgentFeedMessage
  | MarkFeedReadMessage
  | DismissFeedItemsMessage
  | ClearReadFeedItemsMessage;

// Authentication message (sent after WebSocket connection)
export interface AuthMessage {
  type: 'auth';
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
  resend?: boolean;  // True when resending the last user message — server skips inserting a duplicate user message
}

export interface RunCancelMessage {
  type: 'run_cancel';
  runId: string;
}

export interface KillLeakedProcessesMessage {
  type: 'kill_leaked_processes';
}

export interface StopBackgroundTaskMessage {
  type: 'stop_background_task';
  sessionId: string;
  taskId: string;
  cliPid?: number;
  taskRootPid?: number;
  taskCommand?: string;
}

export interface PermissionDecisionMessage {
  type: 'permission_decision';
  requestId: string;
  allow: boolean;
  remember?: boolean;
  /** Optional user feedback attached to a deny decision (e.g., deny ExitPlanMode with guidance). */
  feedback?: string;
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
  workingDirectory?: string;
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

export interface TerminalAttachMessage {
  type: 'terminal_attach';
  terminalId: string;
  cols: number;
  rows: number;
}

export interface TerminalDetachMessage {
  type: 'terminal_detach';
  terminalId: string;
}

// Plugin permission response (Client → Server)
export interface PluginPermissionResponseMessage {
  type: 'plugin_permission_response';
  pluginId: string;
  granted: boolean;
  permanently?: boolean;
}

// Supervision v2: Client → Server messages

export interface GetSupervisionTasksMessage {
  type: 'get_supervision_tasks';
  projectId: string;
}

export interface AddSupervisionTaskMessage {
  type: 'add_supervision_task';
  projectId: string;
  task: {
    title: string;
    description: string;
    dependencies?: string[];
    dependencyMode?: 'all' | 'any';
    priority?: number;
    acceptanceCriteria?: string[];
    relevantDocIds?: string[];
    scope?: string[];
  };
}

export interface UpdateSupervisionTaskMessage {
  type: 'update_supervision_task';
  taskId: string;
  updates: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'status'
    | 'acceptanceCriteria' | 'dependencies' | 'dependencyMode'>>;
}

export interface InitSupervisionAgentMessage {
  type: 'init_supervision_agent';
  projectId: string;
  config?: Partial<SupervisorConfig>;
}

export interface UpdateSupervisionAgentMessage {
  type: 'update_supervision_agent';
  projectId: string;
  action: 'pause' | 'resume' | 'archive' | 'approve_setup';
}

export interface ReloadSupervisionContextMessage {
  type: 'reload_supervision_context';
  projectId: string;
}

// ============================================
// Server → Client messages
// ============================================

export type ServerMessage =
  | AuthResultMessage
  | RunStartedMessage
  | SessionCreatedMessage
  | SystemInfoMessage
  | DeltaMessage
  | ToolUseMessage
  | ToolResultMessage
  | ToolActivityMessage
  | ModeChangeMessage
  | RunCompletedMessage
  | RunFailedMessage
  | PermissionRequestMessage
  | AskUserQuestionMessage
  | AgentPermissionInterceptedMessage
  | BackgroundTaskUpdateMessage
  | BackgroundPermissionPendingMessage
  | TaskNotificationMessage
  | TaskProgressMessage
  | TaskStatusNotificationMessage
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
  // Supervision v2
  | SupervisionTaskUpdateMessage
  | SupervisionAgentUpdateMessage
  | SupervisionCheckpointMessage
  | PermissionResolvedMessage
  | PermissionAutoResolvedMessage
  | AskUserQuestionResolvedMessage
  | StateHeartbeatMessage
  | TerminalOpenedMessage
  | TerminalOutputMessage
  | TerminalExitedMessage
  | TerminalAttachedMessage
  | FilePushNotificationMessage
  | PluginStateMessage
  | PluginPermissionRequestMessage
  | PluginNotificationMessage
  | ProcessCleanupResultMessage
  | PluginShowPanelMessage
  | PluginPanelRegisteredMessage
  | PluginPanelUnregisteredMessage
  | LocalPRUpdateMessage
  | LocalPRDeletedMessage
  | ScheduledTaskUpdateMessage
  | ScheduledTaskDeletedMessage
  | SystemTaskUpdateMessage
  | WorkflowUpdateMessage
  | WorkflowDeletedMessage
  | WorkflowRunUpdateMessage
  | WorkflowStepTypesChangedMessage
  // Unified interaction events
  | AskUserInteractionMessage
  | TodoUpdateInteractionMessage
  | AskUserFormInteractionMessage
  | ApprovalInteractionMessage
  | InteractionResolvedMessage
  // Claudia Tasks
  | ClaudiaTaskCreatedMessage
  | ClaudiaTaskSnapshotMessage
  | ClaudiaTaskUpdateMessage
  | ClaudiaTaskDeltaMessage
  // Claudia inline messages
  | ClaudiaMessageDeltaMessage
  | ClaudiaMessageCompletedMessage
  | ClaudiaMessageFailedMessage
  | ClaudiaMessagePromotedMessage
  // Agent Feed
  | AgentFeedUpdateMessage
  | AgentFeedListMessage
  | AgentFeedReadMessage;

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
  sessionType?: SessionType;
  /** Monotonically increasing event sequence number within this run (starts at 1) */
  seq?: number;
  /** PCP effective provider profile for this run */
  effectiveProfile?: import('../core/pcp.js').PCPEffectiveProfile;
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
  seq?: number;
}

export interface DeltaMessage {
  type: 'delta';
  runId: string;
  sessionId: string;
  content: string;
  seq?: number;
}

export interface ToolUseMessage {
  type: 'tool_use';
  runId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  toolInput: unknown;
  seq?: number;
}

export interface ToolResultMessage {
  type: 'tool_result';
  runId: string;
  sessionId: string;
  toolUseId: string;
  toolName: string;
  result: unknown;
  isError?: boolean;
  seq?: number;
}

export interface ToolActivityMessage {
  type: 'tool_activity';
  runId: string;
  sessionId: string;
  toolUseId: string;
  content: string;
  seq?: number;
}

export interface ModeChangeMessage {
  type: 'mode_change';
  runId: string;
  sessionId: string;
  mode: string;
  seq?: number;
}

export interface RunCompletedMessage {
  type: 'run_completed';
  runId: string;
  sessionId: string;
  usage?: UsageInfo;
  seq?: number;
}

export interface RunFailedMessage {
  type: 'run_failed';
  runId: string;
  sessionId: string;
  error: string;
  seq?: number;
}

export interface PermissionRequestMessage {
  type: 'permission_request';
  requestId: string;
  sessionId: string;
  toolName: string;
  detail: string;
  matchedRule?: string;
  timeoutSeconds: number;
  /** When true, the UI should show a password input for credential (e.g. sudo). */
  requiresCredential?: boolean;
  /** Hint for what kind of credential is needed (e.g. 'sudo_password'). */
  credentialHint?: string;
  /** When true, timeout will auto-approve (not deny); show countdown accordingly. */
  aiInitiated?: boolean;
}

// AskUserQuestion: interactive question UI (Server → Client)
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
  seq?: number;
  cliPid?: number;         // CLI subprocess PID (for process-tree based task killing)
  taskCommand?: string;    // Actual command being run (e.g. "npm test")
  taskRootPid?: number;    // Root PID of the task's process tree
}

// SDK background task progress update (Server → Client)
export interface TaskProgressMessage {
  type: 'task_progress';
  runId: string;
  sessionId: string;
  taskId: string;
  toolUseId?: string;
  description: string;
  usage: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
  lastToolName?: string;
}

// SDK background task status notification (Server → Client)
export interface TaskStatusNotificationMessage {
  type: 'task_status_notification';
  runId: string;
  sessionId: string;
  taskId: string;
  toolUseId?: string;
  status: 'completed' | 'failed' | 'stopped';
  outputFile: string;
  summary: string;
  usage?: {
    total_tokens: number;
    tool_uses: number;
    duration_ms: number;
  };
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

export interface TerminalAttachedMessage {
  type: 'terminal_attached';
  terminalId: string;
  success: boolean;
  scrollback?: string[];
  error?: string;
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
    /** Effective platform scope: 'universal' (backend-only) or 'desktop' (has UI) */
    platform: 'universal' | 'desktop';
    /** Capability requirements declared in manifest */
    requires?: import('../plugin-types.js').PluginRequirements;
    /** Result of capability negotiation */
    capabilities?: import('../plugin-types.js').CapabilityNegotiationResult;
  }>;
}

// Plugin permission request (Server → Client)
export interface PluginPermissionRequestMessage {
  type: 'plugin_permission_request';
  pluginId: string;
  pluginName: string;
  permissions: string[];
}

// Plugin show panel (Server → Client)
export interface PluginShowPanelMessage {
  type: 'plugin_show_panel';
  pluginId: string;
  panelId: string;
}

// Plugin panel registered (Server → Client) — sent when a plugin activates with panels
export interface PluginPanelRegisteredMessage {
  type: 'plugin_panel_registered';
  panelId: string;
  pluginId: string;
  label: string;
  icon?: string;
  iframeUrl?: string;
  order?: number;
}

// Plugin panel unregistered (Server → Client) — sent when a plugin deactivates
export interface PluginPanelUnregisteredMessage {
  type: 'plugin_panel_unregistered';
  pluginId: string;
}

// Local PR update (Server → Client) — sent on PR status changes
export interface LocalPRUpdateMessage {
  type: 'local_pr_update';
  projectId: string;
  pr: LocalPR;
}

// Local PR deleted (Server → Client) — sent when a finished PR is cleaned up
export interface LocalPRDeletedMessage {
  type: 'local_pr_deleted';
  projectId: string;
  prId: string;
}

// Scheduled task updates (Server → Client)
export interface ScheduledTaskUpdateMessage {
  type: 'scheduled_task_update';
  projectId?: string;
  task: ScheduledTask;
}

export interface ScheduledTaskDeletedMessage {
  type: 'scheduled_task_deleted';
  projectId?: string;
  taskId: string;
}

// System task updates (Server → Client)
export interface SystemTaskUpdateMessage {
  type: 'system_task_update';
  task: SystemTaskInfo;
}

// Plugin notification (Server → Client)
export interface PluginNotificationMessage {
  type: 'plugin_notification';
  pluginId: string;
  title: string;
  body: string;
}

export interface ProcessCleanupResultMessage {
  type: 'process_cleanup_result';
  status: 'clean' | 'killed' | 'skipped_active_runs';
  leakedCount: number;
  killedCount: number;
  activeRunCount: number;
}

// Supervision v2: Server → Client messages

export interface SupervisionTaskUpdateMessage {
  type: 'supervision_task_update';
  task: SupervisionTask;
  projectId: string;
}

export interface SupervisionAgentUpdateMessage {
  type: 'supervision_agent_update';
  projectId: string;
  agent: ProjectAgent;
}

export interface SupervisionCheckpointMessage {
  type: 'supervision_checkpoint';
  projectId: string;
  summary: string;
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
    sessionType?: SessionType;
    /** Latest init/system metadata for this run (if available). */
    systemInfo?: SystemInfo;
    /** Last event sequence number for this run (for gap detection). */
    lastSeq?: number;
  }>;
  pendingPermissions: Array<{
    requestId: string;
    sessionId: string;
    toolName: string;
    detail: string;
    matchedRule?: string;
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
  /** Unread Agent Feed item count — for badge display on reconnect */
  unreadFeedCount?: number;
}

// Workflow messages (Server → Client)
export interface WorkflowRunUpdateMessage {
  type: 'workflow_run_update';
  projectId: string;
  run: WorkflowRun;
  stepRuns: WorkflowStepRun[];
}

export interface WorkflowUpdateMessage {
  type: 'workflow_update';
  projectId: string;
  workflow: Workflow;
}

export interface WorkflowDeletedMessage {
  type: 'workflow_deleted';
  projectId: string;
  workflowId: string;
}

export interface WorkflowStepTypesChangedMessage {
  type: 'workflow_step_types_changed';
}

// Agent Assistant messages

export interface AgentStartMessage {
  type: 'agent_start';
  clientRequestId: string;
  sessionId: string;
  input: string;
  providerId?: string;
  model?: string;
  tools?: string[];
}

export interface AgentCancelMessage {
  type: 'agent_cancel';
  sessionId: string;
}

// ============================================
// Claudia Task messages
// ============================================

export type ClaudiaTaskStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';

// Client → Server: submit a new Claudia task
export interface ClaudiaTaskSubmitMessage {
  type: 'claudia_task_submit';
  clientRequestId: string;
  sessionId: string;     // Claudia hub session
  input: string;
  projectId: string;
  providerId?: string;
}

// Client → Server: continue an existing task
export interface ClaudiaTaskContinueMessage {
  type: 'claudia_task_continue';
  clientRequestId: string;
  taskId: string;          // Original task ID
  sessionId: string;       // Original task's backend session
  input: string;           // Follow-up instruction
}

// Client → Server: cancel an existing Claudia task
export interface ClaudiaTaskCancelMessage {
  type: 'claudia_task_cancel';
  taskId: string;
}

// Server → Client: task created confirmation
export interface ClaudiaTaskCreatedMessage {
  type: 'claudia_task_created';
  clientRequestId: string;
  taskId: string;
  sessionId: string;       // Backend task session
  title: string;
  status: 'queued';
}

export interface ClaudiaTaskSnapshotTask {
  id: string;
  sessionId: string | null;
  input: string;
  title: string;
  status: ClaudiaTaskStatus;
  summary?: string;
  error?: string;
  responseText?: string;
  toolCount?: number;
  createdAt: number;
  updatedAt: number;
}

// Server → Client: full/partial Claudia task snapshot for state recovery
export interface ClaudiaTaskSnapshotMessage {
  type: 'claudia_task_snapshot';
  tasks: ClaudiaTaskSnapshotTask[];
}

// Server → Client: task status update
export interface ClaudiaTaskUpdateMessage {
  type: 'claudia_task_update';
  taskId: string;
  status: ClaudiaTaskStatus;
  sessionId?: string;
  input?: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
  summary?: string;
  error?: string;
  responseText?: string;   // Full assistant response (on completion)
  toolCount?: number;      // Number of tool calls made
}

// Server → Client: streaming text for a running task
export interface ClaudiaTaskDeltaMessage {
  type: 'claudia_task_delta';
  taskId: string;
  content: string;
}

// ============================================
// Claudia inline message flow
// ============================================

// Client → Server: send a message to Claudia (inline first, may promote to task)
export interface ClaudiaMessageMessage {
  type: 'claudia_message';
  clientRequestId: string;
  input: string;
  projectId: string;
  contextProjectIds?: string[];
  primaryContextProjectId?: string;
  providerId?: string;
}

// Server → Client: streaming text for inline response
export interface ClaudiaMessageDeltaMessage {
  type: 'claudia_message_delta';
  clientRequestId: string;
  content: string;
}

// Server → Client: inline response completed (no tool use, fast)
export interface ClaudiaMessageCompletedMessage {
  type: 'claudia_message_completed';
  clientRequestId: string;
  responseText: string;
}

// Server → Client: inline response failed before promotion
export interface ClaudiaMessageFailedMessage {
  type: 'claudia_message_failed';
  clientRequestId: string;
  error: string;
}

// Server → Client: inline response promoted to background task
export interface ClaudiaMessagePromotedMessage {
  type: 'claudia_message_promoted';
  clientRequestId: string;
  taskId: string;
  sessionId: string;
}

// ============================================
// Agent Feed messages
// ============================================

export interface GetAgentFeedMessage {
  type: 'get_agent_feed';
  limit?: number;
  before?: number;
  unreadOnly?: boolean;
}

export interface MarkFeedReadMessage {
  type: 'mark_feed_read';
  itemIds: string[];
}

export interface DismissFeedItemsMessage {
  type: 'dismiss_feed_items';
  itemIds: string[];
}

export interface ClearReadFeedItemsMessage {
  type: 'clear_read_feed_items';
}

export interface AgentFeedUpdateMessage {
  type: 'agent_feed_update';
  item: import('../features/agent-feed.js').AgentFeedItem;
}

export interface AgentFeedListMessage {
  type: 'agent_feed_list';
  items: import('../features/agent-feed.js').AgentFeedItem[];
  hasMore: boolean;
  unreadCount: number;
  append?: boolean;
}

export interface AgentFeedReadMessage {
  type: 'agent_feed_read';
  itemIds: string[];
  readAt: number;
  unreadCount: number;
}
