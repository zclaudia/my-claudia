/**
 * CRUD messages for projects, sessions, servers, and providers.
 * Includes Get/Add/Update/Delete requests, List/OperationResult responses,
 * Created/Updated/Deleted broadcast messages, and session messages / provider commands.
 */

import type { BackendServer } from '../../core/server.js';
import type { ProviderConfig } from '../../core/provider.js';
import type { Session } from '../../core/session.js';
import type { Message } from '../../core/message.js';
import type { Project } from '../../core/project.js';
import type { SlashCommand } from '../../features/commands.js';

// ---- Projects ----

export interface GetProjectsMessage {
  type: 'get_projects';
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

export interface ProjectsListMessage {
  type: 'projects_list';
  projects: Project[];
}

export interface ProjectOperationResultMessage {
  type: 'project_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  project?: Project;
  error?: string;
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

// ---- Sessions ----

export interface GetSessionsMessage {
  type: 'get_sessions';
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

export interface SessionsListMessage {
  type: 'sessions_list';
  sessions: Session[];
}

export interface SessionOperationResultMessage {
  type: 'session_operation_result';
  success: boolean;
  operation: 'add' | 'update' | 'delete';
  session?: Session;
  error?: string;
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

export interface GetSessionMessagesMessage {
  type: 'get_session_messages';
  sessionId: string;
  limit?: number;
  before?: number;  // timestamp
}

export interface SessionMessagesMessage {
  type: 'session_messages';
  sessionId: string;
  messages: Message[];
  hasMore: boolean;
}

// ---- Servers ----

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

// ---- Providers ----

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

// ---- Provider Commands ----

export interface GetProviderCommandsMessage {
  type: 'get_provider_commands';
  providerId: string;
  projectRoot?: string;
}

export interface ProviderCommandsMessage {
  type: 'provider_commands';
  providerId: string;
  commands: SlashCommand[];
}
