// WebSocket Protocol Message Types — aggregated from domain sub-modules.
// Import individual sub-modules for focused access, or import from here for the full set.

export * from './core.js';
export * from './run.js';
export * from './crud.js';
export * from './terminal.js';
export * from './permissions.js';
export * from './supervision.js';
export * from './claudia.js';
export * from './workflow.js';
export * from './notification-feed.js';
export * from './plugins.js';

// Re-import interaction types needed for the ServerMessage union
import type { AskUserInteractionMessage, TodoUpdateInteractionMessage, AskUserFormInteractionMessage, ApprovalInteractionMessage, InteractionResolvedMessage, InteractionResponseMessage } from '../../interaction/forms.js';
export type { InteractionResponseMessage };

// ============================================
// Client → Server messages (union type)
// ============================================

import type {
  AuthMessage, PingMessage,
} from './core.js';
import type {
  RunStartMessage, RunCancelMessage, KillLeakedProcessesMessage,
  StopBackgroundTaskMessage, AgentStartMessage, AgentCancelMessage,
} from './run.js';
import type {
  GetProjectsMessage, GetSessionsMessage, GetServersMessage,
  AddServerMessage, UpdateServerMessage, DeleteServerMessage,
  AddSessionMessage, UpdateSessionMessage, DeleteSessionMessage,
  AddProjectMessage, UpdateProjectMessage, DeleteProjectMessage,
  GetProvidersMessage, AddProviderMessage, UpdateProviderMessage, DeleteProviderMessage,
  GetSessionMessagesMessage, GetProviderCommandsMessage,
} from './crud.js';
import type {
  TerminalOpenMessage, TerminalInputMessage, TerminalResizeMessage,
  TerminalCloseMessage, TerminalAttachMessage, TerminalDetachMessage,
} from './terminal.js';
import type {
  PermissionDecisionMessage, AskUserAnswerMessage, PluginPermissionResponseMessage,
} from './permissions.js';
import type {
  GetSupervisionTasksMessage, AddSupervisionTaskMessage, UpdateSupervisionTaskMessage,
  InitSupervisionAgentMessage, UpdateSupervisionAgentMessage, ReloadSupervisionContextMessage,
} from './supervision.js';
import type {
  ClaudiaTaskSubmitMessage, ClaudiaTaskContinueMessage, ClaudiaTaskCancelMessage,
  ClaudiaMessageMessage,
} from './claudia.js';
import type {
  GetNotificationsMessage, MarkNotificationsReadMessage, DismissNotificationsMessage, ClearReadNotificationsMessage,
} from './notification-feed.js';

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
  // Notifications
  | GetNotificationsMessage
  | MarkNotificationsReadMessage
  | DismissNotificationsMessage
  | ClearReadNotificationsMessage;

// ============================================
// Server → Client messages (union type)
// ============================================

import type {
  AuthResultMessage, PongMessage, ErrorMessage, StateHeartbeatMessage, SystemInfoMessage,
} from './core.js';
import type {
  RunStartedMessage, SessionCreatedMessage,
  DeltaMessage, ToolUseMessage, ToolResultMessage, ToolActivityMessage,
  ModeChangeMessage, RunCompletedMessage, RunFailedMessage,
  BackgroundTaskUpdateMessage, BackgroundPermissionPendingMessage,
  TaskNotificationMessage, TaskProgressMessage, TaskStatusNotificationMessage,
  ProcessCleanupResultMessage,
} from './run.js';
import type {
  ProjectsListMessage, SessionsListMessage, ServersListMessage,
  ServerOperationResultMessage, SessionOperationResultMessage, ProjectOperationResultMessage,
  ProvidersListMessage, ProviderOperationResultMessage,
  SessionMessagesMessage, ProviderCommandsMessage,
  ServersCreatedMessage, ServersUpdatedMessage, ServersDeletedMessage,
  SessionsCreatedMessage, SessionsUpdatedMessage, SessionsDeletedMessage,
  ProjectsCreatedMessage, ProjectsUpdatedMessage, ProjectsDeletedMessage,
  ProvidersCreatedMessage, ProvidersUpdatedMessage, ProvidersDeletedMessage,
} from './crud.js';
import type {
  TerminalOpenedMessage, TerminalOutputMessage, TerminalExitedMessage, TerminalAttachedMessage,
} from './terminal.js';
import type {
  PermissionRequestMessage, AskUserQuestionMessage, AgentPermissionInterceptedMessage,
  PermissionResolvedMessage, PermissionAutoResolvedMessage, AskUserQuestionResolvedMessage,
  PluginPermissionRequestMessage,
} from './permissions.js';
import type {
  SupervisionTaskUpdateMessage, SupervisionAgentUpdateMessage, SupervisionCheckpointMessage,
} from './supervision.js';
import type {
  ClaudiaTaskCreatedMessage, ClaudiaTaskSnapshotMessage, ClaudiaTaskUpdateMessage,
  ClaudiaTaskDeltaMessage, ClaudiaMessageDeltaMessage, ClaudiaMessageCompletedMessage,
  ClaudiaMessageFailedMessage, ClaudiaMessagePromotedMessage,
} from './claudia.js';
import type {
  WorkflowRunUpdateMessage, WorkflowUpdateMessage, WorkflowDeletedMessage,
  WorkflowStepTypesChangedMessage, ScheduledTaskUpdateMessage, ScheduledTaskDeletedMessage,
  SystemTaskUpdateMessage, LocalPRUpdateMessage, LocalPRDeletedMessage,
} from './workflow.js';
import type {
  NotificationUpdateMessage, NotificationListMessage, NotificationReadMessage,
} from './notification-feed.js';
import type {
  PluginStateMessage, PluginNotificationMessage, PluginShowPanelMessage,
  PluginPanelRegisteredMessage, PluginPanelUnregisteredMessage, FilePushNotificationMessage,
} from './plugins.js';

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
  // Notifications
  | NotificationUpdateMessage
  | NotificationListMessage
  | NotificationReadMessage;
