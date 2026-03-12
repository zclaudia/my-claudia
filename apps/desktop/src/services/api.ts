import type {
  Project,
  Session,
  Message,
  ProviderConfig,
  ProviderCapabilities,
  BackendServer,
  SlashCommand,
  ApiResponse,
  DirectoryListingResponse,
  FileContentResponse,
  CommandExecuteRequest,
  CommandExecuteResponse,
  ServerInfo,
  ServerGatewayConfig,
  ServerGatewayStatus,
  ServerFeature,
  GitWorktree,
  LocalPR,
  WorktreeConfig,
  ScheduledTask,
  ScheduledTaskTemplate,
  SystemTaskInfo,
  TaskRun,
  Workflow,
  WorkflowDefinition,
  WorkflowRun,
  WorkflowStepRun,
  WorkflowTemplate,
  WorkflowStepTypeMeta,
  SessionDraft,
} from '@my-claudia/shared';
import { useServerStore } from '../stores/serverStore';
import { isGatewayTarget, parseBackendId } from '../stores/gatewayStore';
import { resolveGatewayBackendUrl, getGatewayAuthHeaders } from './gatewayProxy';

/** Check if the active server advertises a specific feature. */
function activeServerSupports(feature: ServerFeature): boolean {
  return useServerStore.getState().activeServerSupports(feature);
}

// Custom error class for authentication errors
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export function getBaseUrl(): string {
  const activeId = useServerStore.getState().activeServerId;

  // Gateway target: delegate to shared gateway proxy resolver
  if (isGatewayTarget(activeId)) {
    const backendId = parseBackendId(activeId!);
    const url = resolveGatewayBackendUrl(backendId);
    if (!url) throw new Error('Gateway not configured');
    return url;
  }

  // Direct server: connect directly to backend
  const server = useServerStore.getState().getActiveServer();
  if (!server) {
    throw new Error('No server configured');
  }
  const address = server.address.includes('://')
    ? server.address
    : `http://${server.address}`;
  return address;
}

// Get authentication header for the active server
export function getAuthHeaders(): HeadersInit {
  const activeId = useServerStore.getState().activeServerId;

  // Gateway target: delegate to shared gateway auth resolver
  if (isGatewayTarget(activeId)) {
    return getGatewayAuthHeaders();
  }

  // Direct server: no auth needed (server trusts localhost connections)
  return {};
}

async function fetchApi<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const baseUrl = getBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getAuthHeaders(),
      ...options?.headers
    }
  });

  // Handle authentication errors
  if (response.status === 401) {
    throw new AuthError('Authentication required');
  }
  if (response.status === 403) {
    throw new AuthError('Access forbidden');
  }

  return response.json();
}

// ============================================
// Local API: always targets the local server
// Used by Settings, data loader, and admin features
// ============================================

function getLocalBaseUrl(): string {
  const server = useServerStore.getState().getDefaultServer();
  const address = server?.address || 'localhost:3100';
  return address.includes('://') ? address : `http://${address}`;
}

function getLocalAuthHeaders(): HeadersInit {
  // Local server trusts localhost connections, no auth needed
  return {};
}

export async function fetchLocalApi<T>(
  path: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  const baseUrl = getLocalBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...getLocalAuthHeaders(),
      ...options?.headers
    }
  });

  if (response.status === 401) {
    throw new AuthError('Authentication required');
  }
  if (response.status === 403) {
    throw new AuthError('Access forbidden');
  }

  return response.json();
}

// ============================================
// Projects API — routes to active server
// ============================================

export async function getProjects(): Promise<Project[]> {
  const result = await fetchApi<Project[]>('/api/projects');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch projects');
  }
  return result.data;
}

export async function createProject(data: {
  name: string;
  type?: 'chat_only' | 'code';
  providerId?: string;
  rootPath?: string;
}): Promise<Project> {
  const result = await fetchApi<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create project');
  }
  return result.data;
}

export async function updateProject(
  id: string,
  data: Partial<Project>
): Promise<void> {
  const result = await fetchApi<void>(`/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update project');
  }
}

export async function deleteProject(id: string): Promise<void> {
  const result = await fetchApi<void>(`/api/projects/${id}`, {
    method: 'DELETE'
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete project');
  }
}

// ============================================
// Sessions API — routes to active server
// ============================================

export async function getSessions(projectId?: string): Promise<Session[]> {
  const query = projectId ? `?projectId=${projectId}` : '';
  const result = await fetchApi<Session[]>(`/api/sessions${query}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch sessions');
  }
  return result.data;
}

export async function getSessionRunState(sessionId: string): Promise<{ sessionId: string; isRunning: boolean; activeRunId?: string }> {
  const result = await fetchApi<{ sessionId: string; isRunning: boolean; activeRunId?: string }>(`/api/sessions/${sessionId}/run-state`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch session run state');
  }
  return result.data;
}

export async function createSession(data: {
  projectId: string;
  name?: string;
  providerId?: string;
  type?: 'regular' | 'background';
  parentSessionId?: string;
}): Promise<Session> {
  const result = await fetchApi<Session>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create session');
  }
  return result.data;
}

export async function updateSession(
  id: string,
  data: Partial<Session>
): Promise<void> {
  const result = await fetchApi<void>(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update session');
  }
}

export async function updateSessionWorkingDirectory(
  sessionId: string,
  workingDirectory: string
): Promise<void> {
  const result = await fetchApi<Session>(`/api/sessions/${sessionId}/working-directory`, {
    method: 'PATCH',
    body: JSON.stringify({ workingDirectory })
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update working directory');
  }
}

export async function resetSessionSdkSession(sessionId: string): Promise<void> {
  const result = await fetchApi<{ sessionId: string; reset: boolean }>(`/api/sessions/${sessionId}/reset-sdk-session`, {
    method: 'POST',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to reset SDK session');
  }
}

export async function dismissInterrupted(sessionId: string): Promise<void> {
  await fetchApi(`/api/sessions/${sessionId}/dismiss-interrupted`, { method: 'PATCH' });
}

export async function unlockSession(sessionId: string): Promise<Session> {
  const result = await fetchApi<Session>(`/api/sessions/${sessionId}/unlock`, {
    method: 'PATCH',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to unlock session');
  }
  return result.data;
}

export async function getProjectWorktrees(projectId: string): Promise<GitWorktree[]> {
  const result = await fetchApi<GitWorktree[]>(`/api/projects/${projectId}/worktrees`);
  if (!result.success || !result.data) return [];
  return result.data;
}

export async function createProjectWorktree(
  projectId: string,
  branch: string,
  path?: string,
): Promise<GitWorktree> {
  const result = await fetchApi<GitWorktree>(`/api/projects/${projectId}/worktrees`, {
    method: 'POST',
    body: JSON.stringify({ branch, path }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create worktree');
  }
  return result.data;
}

export async function deleteSession(id: string): Promise<void> {
  const result = await fetchApi<void>(`/api/sessions/${id}`, {
    method: 'DELETE'
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete session');
  }
}

export async function archiveSessions(sessionIds: string[]): Promise<void> {
  const result = await fetchApi<void>('/api/sessions/archive', {
    method: 'POST',
    body: JSON.stringify({ sessionIds })
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to archive sessions');
  }
}

export async function restoreSessions(sessionIds: string[]): Promise<void> {
  const result = await fetchApi<void>('/api/sessions/restore', {
    method: 'POST',
    body: JSON.stringify({ sessionIds })
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to restore sessions');
  }
}

export async function getArchivedSessions(): Promise<Session[]> {
  const result = await fetchApi<Session[]>('/api/sessions/archived');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch archived sessions');
  }
  return result.data;
}

// ============================================
// Session Draft API
// ============================================

export async function getSessionDraft(sessionId: string): Promise<SessionDraft | null> {
  const result = await fetchApi<SessionDraft | null>(`/api/sessions/${sessionId}/draft`);
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to fetch draft');
  }
  return result.data ?? null;
}

export async function upsertSessionDraft(
  sessionId: string,
  content: string,
  deviceId?: string
): Promise<SessionDraft> {
  const result = await fetchApi<SessionDraft>(`/api/sessions/${sessionId}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ content, deviceId }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to save draft');
  }
  return result.data;
}

export async function lockSessionDraft(
  sessionId: string,
  deviceId: string,
  force?: boolean
): Promise<{ locked: boolean; draft: SessionDraft | null }> {
  const result = await fetchApi<{ locked: boolean; draft: SessionDraft | null }>(
    `/api/sessions/${sessionId}/draft/lock`,
    {
      method: 'POST',
      body: JSON.stringify({ deviceId, force }),
    }
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to lock draft');
  }
  return result.data;
}

export async function unlockSessionDraft(
  sessionId: string,
  deviceId: string
): Promise<void> {
  await fetchApi(`/api/sessions/${sessionId}/draft/unlock`, {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
}

export async function archiveSessionDraft(sessionId: string): Promise<void> {
  const result = await fetchApi(`/api/sessions/${sessionId}/draft/archive`, {
    method: 'POST',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to archive draft');
  }
}

interface PaginationInfo {
  total: number;
  hasMore: boolean;
  oldestTimestamp?: number;
  newestTimestamp?: number;
  maxOffset?: number;
}

interface MessagesResponse {
  messages: Message[];
  pagination: PaginationInfo;
  activeRun?: { runId: string } | null;
}

export async function getSessionMessages(
  sessionId: string,
  options?: {
    limit?: number;
    before?: number;
    after?: number;
    afterOffset?: number;
  }
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', String(options.before));
  if (options?.after) params.set('after', String(options.after));
  if (options?.afterOffset != null) params.set('afterOffset', String(options.afterOffset));

  const query = params.toString() ? `?${params.toString()}` : '';
  const result = await fetchApi<MessagesResponse>(`/api/sessions/${sessionId}/messages${query}`);

  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch messages');
  }
  return result.data;
}

// ============================================
// Session Export & Search API
// ============================================

export async function exportSession(sessionId: string): Promise<{ markdown: string; sessionName: string }> {
  const result = await fetchApi<{ markdown: string; sessionName: string }>(`/api/sessions/${sessionId}/export`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to export session');
  }
  return result.data;
}

export interface SearchResult {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: number;
  sessionName: string | null;
  resultType?: 'message' | 'file' | 'tool_call';
}

export type SearchScope = 'messages' | 'files' | 'tool_calls' | 'all';

export interface SearchFilters {
  projectId?: string;
  role?: 'user' | 'assistant';
  sessionIds?: string[];
  dateRange?: { start: number; end: number };
  sort?: 'relevance' | 'newest' | 'oldest' | 'session';
  scope?: SearchScope;
  limit?: number;
  offset?: number;
}

export async function searchMessages(query: string, filters?: SearchFilters): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });

  if (filters) {
    if (filters.projectId) params.set('projectId', filters.projectId);
    if (filters.role) params.set('role', filters.role);
    if (filters.sessionIds && filters.sessionIds.length > 0) {
      params.set('sessionIds', filters.sessionIds.join(','));
    }
    if (filters.dateRange) {
      params.set('startDate', filters.dateRange.start.toString());
      params.set('endDate', filters.dateRange.end.toString());
    }
    if (filters.sort) params.set('sort', filters.sort);
    if (filters.scope) params.set('scope', filters.scope);
    if (filters.limit) params.set('limit', filters.limit.toString());
    if (filters.offset !== undefined) params.set('offset', filters.offset.toString());
  }

  const result = await fetchApi<{ results: SearchResult[] }>(`/api/sessions/search/messages?${params}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to search messages');
  }
  return result.data.results;
}

export interface SearchHistoryEntry {
  id: string;
  userId: string;
  query: string;
  resultCount: number;
  createdAt: number;
}

export async function getSearchHistory(userId?: string, limit?: number): Promise<SearchHistoryEntry[]> {
  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);
  if (limit) params.set('limit', limit.toString());

  const result = await fetchApi<{ history: SearchHistoryEntry[] }>(`/api/sessions/search/history?${params}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch search history');
  }
  return result.data.history;
}

export async function clearSearchHistory(userId?: string): Promise<void> {
  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);

  const result = await fetchApi(`/api/sessions/search/history?${params}`, {
    method: 'DELETE',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to clear search history');
  }
}

export async function getSearchSuggestions(prefix: string, userId?: string, limit?: number): Promise<string[]> {
  const params = new URLSearchParams({ prefix });
  if (userId) params.set('userId', userId);
  if (limit) params.set('limit', limit.toString());

  const result = await fetchApi<{ suggestions: string[] }>(`/api/sessions/search/suggestions?${params}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch search suggestions');
  }
  return result.data.suggestions;
}

// ============================================
// Providers API
// ============================================

export async function getProviders(): Promise<ProviderConfig[]> {
  const result = await fetchApi<ProviderConfig[]>('/api/providers');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch providers');
  }
  return result.data;
}

export async function createProvider(data: {
  name: string;
  type?: string;
  cliPath?: string;
  env?: Record<string, string>;
  isDefault?: boolean;
}): Promise<ProviderConfig> {
  const result = await fetchApi<ProviderConfig>('/api/providers', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create provider');
  }
  return result.data;
}

export async function updateProvider(
  id: string,
  data: Partial<ProviderConfig>
): Promise<void> {
  const result = await fetchApi<void>(`/api/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update provider');
  }
}

export async function deleteProvider(id: string): Promise<void> {
  const result = await fetchApi<void>(`/api/providers/${id}`, {
    method: 'DELETE'
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete provider');
  }
}

export async function setDefaultProvider(id: string): Promise<void> {
  if (!activeServerSupports('setDefaultProvider')) {
    console.warn('[API] setDefaultProvider not supported by active server, skipping');
    return;
  }
  const result = await fetchApi<void>(`/api/providers/${id}/set-default`, {
    method: 'POST'
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to set default provider');
  }
}

export async function getProviderCommands(
  providerId: string,
  projectRoot?: string
): Promise<SlashCommand[]> {
  const query = projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : '';
  if (activeServerSupports('providerCommands')) {
    const result = await fetchApi<SlashCommand[]>(`/api/providers/${providerId}/commands${query}`);
    if (result.success && result.data) return result.data;
  }
  // Degrade: query local server for default commands
  const localResult = await fetchLocalApi<SlashCommand[]>(`/api/providers/type/claude/commands${query}`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider commands');
  }
  return localResult.data;
}

export async function getProviderTypeCommands(
  providerType: string,
  projectRoot?: string
): Promise<SlashCommand[]> {
  const query = projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : '';
  if (activeServerSupports('providerCommands')) {
    const result = await fetchApi<SlashCommand[]>(`/api/providers/type/${providerType}/commands${query}`);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<SlashCommand[]>(`/api/providers/type/${providerType}/commands${query}`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider type commands');
  }
  return localResult.data;
}

export async function getProviderCapabilities(
  providerId: string
): Promise<ProviderCapabilities> {
  if (activeServerSupports('providerCapabilities')) {
    const result = await fetchApi<ProviderCapabilities>(`/api/providers/${providerId}/capabilities`);
    if (result.success && result.data) return result.data;
  }
  // Degrade: query local server for default capabilities
  const localResult = await fetchLocalApi<ProviderCapabilities>(`/api/providers/type/claude/capabilities`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider capabilities');
  }
  return localResult.data;
}

export async function getProviderTypeCapabilities(
  providerType: string
): Promise<ProviderCapabilities> {
  if (activeServerSupports('providerCapabilities')) {
    const result = await fetchApi<ProviderCapabilities>(`/api/providers/type/${providerType}/capabilities`);
    if (result.success && result.data) return result.data;
  }
  const localResult = await fetchLocalApi<ProviderCapabilities>(`/api/providers/type/${providerType}/capabilities`);
  if (!localResult.success || !localResult.data) {
    throw new Error(localResult.error?.message || 'Failed to fetch provider type capabilities');
  }
  return localResult.data;
}

// ============================================
// Files API (for @ mentions)
// ============================================

export async function listDirectory(params: {
  projectRoot: string;
  relativePath?: string;
  query?: string;
  maxResults?: number;
}): Promise<DirectoryListingResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    ...(params.relativePath && { relativePath: params.relativePath }),
    ...(params.query && { query: params.query }),
    ...(params.maxResults !== undefined && { maxResults: String(params.maxResults) })
  });

  const result = await fetchApi<DirectoryListingResponse>(`/api/files/list?${queryParams}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to list directory');
  }
  return result.data;
}

export async function getFileContent(params: {
  projectRoot: string;
  relativePath: string;
}): Promise<FileContentResponse> {
  const queryParams = new URLSearchParams({
    projectRoot: params.projectRoot,
    relativePath: params.relativePath,
  });

  const result = await fetchApi<FileContentResponse>(`/api/files/content?${queryParams}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch file content');
  }
  return result.data;
}

// ============================================
// Commands API
// ============================================

export interface CommandListResponse {
  builtin: SlashCommand[];
  custom: SlashCommand[];
  count: number;
}

export async function listCommands(projectPath?: string): Promise<CommandListResponse> {
  const result = await fetchApi<CommandListResponse>('/api/commands/list', {
    method: 'POST',
    body: JSON.stringify({ projectPath })
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to list commands');
  }
  return result.data;
}

export async function executeCommand(request: CommandExecuteRequest): Promise<CommandExecuteResponse> {
  const result = await fetchApi<CommandExecuteResponse>('/api/commands/execute', {
    method: 'POST',
    body: JSON.stringify(request)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to execute command');
  }
  return result.data;
}

// ============================================
// Authentication API
// ============================================

/**
 * Get server info (including whether authentication is required)
 * This endpoint doesn't require authentication
 */
export async function getServerInfo(address: string): Promise<ServerInfo> {
  const url = address.includes('://') ? address : `http://${address}`;
  const response = await fetch(`${url}/api/server/info`);
  const result: ApiResponse<ServerInfo> = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get server info');
  }
  return result.data;
}

// ============================================
// Server Gateway Configuration API
// ============================================

/**
 * Get server Gateway configuration (local only)
 */
export async function getServerGatewayConfig(): Promise<ServerGatewayConfig> {
  const result = await fetchLocalApi<ServerGatewayConfig>('/api/server/gateway/config');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get gateway config');
  }
  return result.data;
}

/**
 * Update server Gateway configuration (local only)
 */
export async function updateServerGatewayConfig(config: {
  enabled?: boolean;
  gatewayUrl?: string;
  gatewaySecret?: string;
  backendName?: string;
}): Promise<ServerGatewayConfig> {
  const result = await fetchLocalApi<ServerGatewayConfig>('/api/server/gateway/config', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update gateway config');
  }
  return result.data;
}

/**
 * Get server Gateway status (local only)
 */
export async function getServerGatewayStatus(): Promise<ServerGatewayStatus> {
  const result = await fetchLocalApi<ServerGatewayStatus>('/api/server/gateway/status');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get gateway status');
  }
  return result.data;
}

/**
 * Connect server to Gateway (local only)
 */
export async function connectServerToGateway(): Promise<{ message: string }> {
  const result = await fetchLocalApi<{ message: string }>('/api/server/gateway/connect', {
    method: 'POST'
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to connect to gateway');
  }
  return result.data;
}

/**
 * Disconnect server from Gateway (local only)
 */
export async function disconnectServerFromGateway(): Promise<{ message: string }> {
  const result = await fetchLocalApi<{ message: string }>('/api/server/gateway/disconnect', {
    method: 'POST'
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to disconnect from gateway');
  }
  return result.data;
}

// ============================================
// Servers API
// ============================================

export async function getServers(): Promise<BackendServer[]> {
  const result = await fetchLocalApi<BackendServer[]>('/api/servers');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch servers');
  }
  return result.data;
}

export async function createServer(data: Omit<BackendServer, 'id' | 'createdAt' | 'lastConnected'>): Promise<BackendServer> {
  const result = await fetchLocalApi<BackendServer>('/api/servers', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create server');
  }
  return result.data;
}

export async function updateServer(
  id: string,
  data: Partial<Omit<BackendServer, 'id' | 'createdAt'>>
): Promise<void> {
  const result = await fetchLocalApi<void>(`/api/servers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update server');
  }
}

export async function deleteServer(id: string): Promise<void> {
  const result = await fetchLocalApi<void>(`/api/servers/${id}`, {
    method: 'DELETE'
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete server');
  }
}

// ============================================
// Agent API — routes to active server
// ============================================

export async function ensureAgent(): Promise<{ projectId: string; sessionId: string }> {
  const result = await fetchApi<{ projectId: string; sessionId: string }>('/api/agent/ensure', {
    method: 'POST'
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to ensure agent');
  }
  return result.data;
}

export async function getAgentConfig(): Promise<{
  enabled: boolean;
  projectId: string | null;
  sessionId: string | null;
  providerId: string | null;
  permissionPolicy: string | null;
}> {
  const result = await fetchApi<any>('/api/agent/config');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get agent config');
  }
  return result.data;
}

export async function updateAgentConfig(config: {
  enabled?: boolean;
  providerId?: string;
  permissionPolicy?: string;
}): Promise<void> {
  const result = await fetchApi<void>('/api/agent/config', {
    method: 'PUT',
    body: JSON.stringify(config)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update agent config');
  }
}

// ============================================
// Supervision V2 API
// ============================================

import type {
  ProjectAgent,
  AgentMode,
  SupervisorConfig,
  SupervisionTask,
  SupervisionV2Log,
} from '@my-claudia/shared';

export async function initSupervisionAgent(
  projectId: string,
  config?: Partial<SupervisorConfig>,
  providerId?: string,
  mode?: AgentMode,
): Promise<ProjectAgent> {
  const result = await fetchApi<ProjectAgent>(`/api/v2/projects/${projectId}/agent/init`, {
    method: 'POST',
    body: JSON.stringify({ config, providerId, mode }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to initialize agent');
  }
  return result.data;
}

export async function getSupervisionAgent(projectId: string): Promise<ProjectAgent | null> {
  const result = await fetchApi<ProjectAgent>(`/api/v2/projects/${projectId}/agent`);
  if (!result.success) {
    if (result.error?.code === 'NOT_FOUND') return null;
    throw new Error(result.error?.message || 'Failed to get agent');
  }
  return result.data ?? null;
}

export async function updateSupervisionAgentAction(
  projectId: string,
  action: 'pause' | 'resume' | 'archive' | 'approve_setup',
): Promise<ProjectAgent> {
  const result = await fetchApi<ProjectAgent>(`/api/v2/projects/${projectId}/agent/action`, {
    method: 'POST',
    body: JSON.stringify({ action }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update agent');
  }
  return result.data;
}

export async function getSupervisionTasks(projectId: string): Promise<SupervisionTask[]> {
  const result = await fetchApi<SupervisionTask[]>(`/api/v2/projects/${projectId}/tasks`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch tasks');
  }
  return result.data;
}

export async function createSupervisionTask(
  projectId: string,
  data: {
    title: string;
    description: string;
    dependencies?: string[];
    dependencyMode?: 'all' | 'any';
    priority?: number;
    acceptanceCriteria?: string[];
    relevantDocIds?: string[];
    scope?: string[];
    scheduleCron?: string;
    scheduleEnabled?: boolean;
    retryDelayMs?: number;
  },
): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/projects/${projectId}/tasks`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create task');
  }
  return result.data;
}

export async function openTaskSession(taskId: string): Promise<{ sessionId: string }> {
  const result = await fetchApi<{ sessionId: string }>(`/api/v2/tasks/${taskId}/open-session`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to open task session');
  }
  return result.data;
}

export interface TaskPlanStatus {
  exists: boolean;
  ready: boolean;
  score: number;
  missing: string[];
  path: string;
}

export async function getTaskPlanStatus(taskId: string): Promise<TaskPlanStatus> {
  const result = await fetchApi<TaskPlanStatus>(`/api/v2/tasks/${taskId}/plan-status`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get task plan status');
  }
  return result.data;
}

export async function submitTaskPlan(taskId: string): Promise<{ task: SupervisionTask; sessionId: string }> {
  const result = await fetchApi<{ task: SupervisionTask; sessionId: string }>(`/api/v2/tasks/${taskId}/plan/submit`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to submit task plan');
  }
  return result.data;
}

export async function updateSupervisionTask(
  taskId: string,
  data: Partial<Pick<SupervisionTask,
    'title' | 'description' | 'priority' | 'dependencies' | 'dependencyMode'
    | 'acceptanceCriteria' | 'relevantDocIds' | 'scope' | 'taskSpecificContext'
  >>,
): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update task');
  }
  return result.data;
}

export async function approveSupervisionTask(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/approve`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to approve task');
  }
  return result.data;
}

export async function rejectSupervisionTask(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/reject`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to reject task');
  }
  return result.data;
}

export async function approveSupervisionTaskResult(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/review/approve`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to approve task result');
  }
  return result.data;
}

export async function rejectSupervisionTaskResult(
  taskId: string,
  notes: string,
): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/review/reject`, {
    method: 'POST',
    body: JSON.stringify({ notes }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to reject task result');
  }
  return result.data;
}

export async function retryTask(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/retry`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to retry task');
  }
  return result.data;
}

export async function cancelTask(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/cancel`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to cancel task');
  }
  return result.data;
}

export async function runTaskNow(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/run-now`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to run task');
  }
  return result.data;
}

export async function resolveSupervisionConflict(taskId: string): Promise<SupervisionTask> {
  const result = await fetchApi<SupervisionTask>(`/api/v2/tasks/${taskId}/resolve-conflict`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to resolve conflict');
  }
  return result.data;
}

export async function reloadSupervisionContext(projectId: string): Promise<void> {
  const result = await fetchApi<null>(`/api/v2/projects/${projectId}/context/reload`, {
    method: 'POST',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to reload context');
  }
}

export async function getSupervisionContext(projectId: string): Promise<any[]> {
  const result = await fetchApi<any[]>(`/api/v2/projects/${projectId}/context`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get context');
  }
  return result.data;
}

export async function getSupervisionBudget(projectId: string): Promise<{
  usage: number;
  limit?: number;
  remaining?: number;
}> {
  const result = await fetchApi<{ usage: number; limit?: number; remaining?: number }>(
    `/api/v2/projects/${projectId}/budget`,
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get budget');
  }
  return result.data;
}

export async function getSupervisionV2Logs(
  projectId: string,
  limit?: number,
): Promise<SupervisionV2Log[]> {
  const params = limit ? `?limit=${limit}` : '';
  const result = await fetchApi<SupervisionV2Log[]>(`/api/v2/projects/${projectId}/logs${params}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get logs');
  }
  return result.data;
}

// ============================================
// Notifications API — routes to active server
// ============================================

import type { NotificationConfig } from '@my-claudia/shared';

export async function getNotificationConfig(): Promise<NotificationConfig> {
  const result = await fetchApi<NotificationConfig>('/api/notifications/config');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get notification config');
  }
  return result.data;
}

export async function updateNotificationConfig(config: NotificationConfig): Promise<void> {
  const result = await fetchApi<void>('/api/notifications/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update notification config');
  }
}

export async function sendTestNotification(): Promise<void> {
  const result = await fetchApi<{ message: string }>('/api/notifications/test', {
    method: 'POST',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to send test notification');
  }
}

// ============================================
// MCP Servers API — routes to local server
// ============================================

import type { McpServerConfig } from '@my-claudia/shared';

export async function getMcpServers(): Promise<McpServerConfig[]> {
  const result = await fetchLocalApi<McpServerConfig[]>('/api/mcp-servers');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch MCP servers');
  }
  return result.data;
}

export async function createMcpServer(config: {
  name: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
  description?: string;
  providerScope?: string[];
}): Promise<McpServerConfig> {
  const result = await fetchLocalApi<McpServerConfig>('/api/mcp-servers', {
    method: 'POST',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create MCP server');
  }
  return result.data;
}

export async function updateMcpServer(id: string, config: Partial<{
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  enabled: boolean;
  description: string;
  providerScope: string[];
}>): Promise<McpServerConfig> {
  const result = await fetchLocalApi<McpServerConfig>(`/api/mcp-servers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update MCP server');
  }
  return result.data;
}

export async function deleteMcpServer(id: string): Promise<void> {
  const result = await fetchLocalApi<null>(`/api/mcp-servers/${id}`, {
    method: 'DELETE',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete MCP server');
  }
}

export async function toggleMcpServer(id: string): Promise<McpServerConfig> {
  const result = await fetchLocalApi<McpServerConfig>(`/api/mcp-servers/${id}/toggle`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to toggle MCP server');
  }
  return result.data;
}

export async function importMcpServers(): Promise<{ imported: McpServerConfig[]; skipped: string[] }> {
  const result = await fetchLocalApi<{ imported: McpServerConfig[]; skipped: string[] }>('/api/mcp-servers/import', {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to import MCP servers');
  }
  return result.data;
}

// ============================================
// Local PR API
// ============================================

export async function listLocalPRs(projectId: string): Promise<LocalPR[]> {
  const result = await fetchApi<LocalPR[]>(`/api/projects/${projectId}/local-prs`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to list local PRs');
  }
  return result.data;
}

export async function createLocalPR(
  projectId: string,
  worktreePath: string,
  options?: { title?: string; description?: string; baseBranch?: string; autoReview?: boolean },
): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/projects/${projectId}/local-prs`, {
    method: 'POST',
    body: JSON.stringify({ worktreePath, ...options }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create local PR');
  }
  return result.data;
}

export async function precheckLocalPRCreation(
  projectId: string,
  worktreePath: string,
): Promise<{ canCreate: boolean; reason?: string }> {
  const params = new URLSearchParams({ worktreePath });
  const result = await fetchApi<{ canCreate: boolean; reason?: string }>(
    `/api/projects/${projectId}/local-prs/precheck?${params.toString()}`
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to check PR eligibility');
  }
  return result.data;
}

export async function closeLocalPR(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/close`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to close local PR');
  }
  return result.data;
}

export async function retryLocalPRReview(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/retry-review`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to retry review');
  }
  return result.data;
}

export async function reviewLocalPR(prId: string, providerId?: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/review`, {
    method: 'POST',
    body: JSON.stringify({ providerId }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to start review');
  }
  return result.data;
}

export async function mergeLocalPR(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/merge`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to merge local PR');
  }
  return result.data;
}

export async function cancelLocalPRMerge(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/cancel-merge`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to cancel merge');
  }
  return result.data;
}

export async function resolveLocalPRConflict(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/resolve-conflict`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to start AI conflict resolution');
  }
  return result.data;
}

export async function reopenLocalPR(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/reopen`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to reopen PR');
  }
  return result.data;
}

export async function revertLocalPRMerge(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/revert-merge`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to revert merged PR');
  }
  return result.data;
}

export async function cancelLocalPRQueue(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/cancel-queue`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to cancel queue');
  }
  return result.data;
}

export async function retryLocalPR(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/retry`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to retry');
  }
  return result.data;
}

export async function setProjectReviewProvider(
  projectId: string,
  providerId: string,
): Promise<void> {
  const result = await fetchApi<void>(`/api/projects/${projectId}/review-provider`, {
    method: 'PATCH',
    body: JSON.stringify({ providerId }),
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to set review provider');
  }
}

// ============================================
// Worktree Config API
// ============================================

export async function getWorktreeConfigs(projectId: string): Promise<WorktreeConfig[]> {
  const result = await fetchApi<WorktreeConfig[]>(`/api/projects/${projectId}/worktree-configs`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to list worktree configs');
  }
  return result.data;
}

export async function upsertWorktreeConfig(
  projectId: string,
  config: { worktreePath: string; autoCreatePR: boolean; autoReview: boolean },
): Promise<WorktreeConfig> {
  const result = await fetchApi<WorktreeConfig>(`/api/projects/${projectId}/worktree-configs`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update worktree config');
  }
  return result.data;
}

// ============================================
// Scheduled Tasks API
// ============================================

export async function listScheduledTasks(projectId: string): Promise<ScheduledTask[]> {
  const result = await fetchApi<ScheduledTask[]>(`/api/projects/${projectId}/scheduled-tasks`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list scheduled tasks');
  return result.data;
}

export async function listGlobalScheduledTasks(): Promise<ScheduledTask[]> {
  const result = await fetchApi<ScheduledTask[]>('/api/scheduled-tasks/global');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list global tasks');
  return result.data;
}

export async function createScheduledTask(projectId: string | undefined, data: Partial<ScheduledTask>): Promise<ScheduledTask> {
  const path = projectId
    ? `/api/projects/${projectId}/scheduled-tasks`
    : '/api/scheduled-tasks/global';
  const result = await fetchApi<ScheduledTask>(path, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to create scheduled task');
  return result.data;
}

export async function updateScheduledTask(taskId: string, data: Partial<ScheduledTask>): Promise<ScheduledTask> {
  const result = await fetchApi<ScheduledTask>(`/api/scheduled-tasks/${taskId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to update scheduled task');
  return result.data;
}

export async function deleteScheduledTask(taskId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/scheduled-tasks/${taskId}`, { method: 'DELETE' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to delete scheduled task');
}

export async function triggerScheduledTask(taskId: string): Promise<ScheduledTask> {
  const result = await fetchApi<ScheduledTask>(`/api/scheduled-tasks/${taskId}/trigger`, { method: 'POST' });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to trigger task');
  return result.data;
}

export async function listScheduledTaskTemplates(): Promise<ScheduledTaskTemplate[]> {
  const result = await fetchApi<ScheduledTaskTemplate[]>('/api/scheduled-task-templates');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list templates');
  return result.data;
}

export async function enableTemplateTask(projectId: string, templateId: string): Promise<ScheduledTask> {
  const result = await fetchApi<ScheduledTask>(
    `/api/projects/${projectId}/scheduled-tasks/from-template/${templateId}`,
    { method: 'POST' },
  );
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to enable template');
  return result.data;
}

// ============================================
// System Tasks & Task Run History API
// ============================================

export async function listSystemTasks(): Promise<SystemTaskInfo[]> {
  const result = await fetchApi<SystemTaskInfo[]>('/api/system-tasks');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list system tasks');
  return result.data;
}

export async function listTaskRuns(taskId: string, limit: number = 50): Promise<TaskRun[]> {
  const result = await fetchApi<TaskRun[]>(`/api/task-runs?taskId=${encodeURIComponent(taskId)}&limit=${limit}`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list task runs');
  return result.data;
}

// ============================================
// Workflow API
// ============================================

export async function listWorkflows(projectId: string): Promise<Workflow[]> {
  const result = await fetchApi<Workflow[]>(`/api/projects/${projectId}/workflows`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list workflows');
  return result.data;
}

export async function getWorkflow(workflowId: string): Promise<Workflow> {
  const result = await fetchApi<Workflow>(`/api/workflows/${workflowId}`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to get workflow');
  return result.data;
}

export async function createWorkflow(projectId: string, data: { name: string; description?: string; definition: WorkflowDefinition; status?: string }): Promise<Workflow> {
  const result = await fetchApi<Workflow>(`/api/projects/${projectId}/workflows`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to create workflow');
  return result.data;
}

export async function updateWorkflow(workflowId: string, data: Partial<Workflow>): Promise<Workflow> {
  const result = await fetchApi<Workflow>(`/api/workflows/${workflowId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to update workflow');
  return result.data;
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/workflows/${workflowId}`, { method: 'DELETE' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to delete workflow');
}

export async function listWorkflowTemplates(): Promise<WorkflowTemplate[]> {
  const result = await fetchApi<WorkflowTemplate[]>('/api/workflow-templates');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list templates');
  return result.data;
}

export async function listWorkflowStepTypes(): Promise<WorkflowStepTypeMeta[]> {
  const result = await fetchApi<WorkflowStepTypeMeta[]>('/api/workflow-step-types');
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list step types');
  return result.data;
}

export async function createWorkflowFromTemplate(projectId: string, templateId: string): Promise<Workflow> {
  const result = await fetchApi<Workflow>(
    `/api/projects/${projectId}/workflows/from-template/${templateId}`,
    { method: 'POST' },
  );
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to create from template');
  return result.data;
}

export async function triggerWorkflow(workflowId: string): Promise<WorkflowRun> {
  const result = await fetchApi<WorkflowRun>(`/api/workflows/${workflowId}/trigger`, { method: 'POST' });
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to trigger workflow');
  return result.data;
}

export async function listWorkflowRuns(workflowId: string, limit?: number): Promise<WorkflowRun[]> {
  const url = limit ? `/api/workflows/${workflowId}/runs?limit=${limit}` : `/api/workflows/${workflowId}/runs`;
  const result = await fetchApi<WorkflowRun[]>(url);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to list runs');
  return result.data;
}

export async function getWorkflowRun(runId: string): Promise<{ run: WorkflowRun; stepRuns: WorkflowStepRun[] }> {
  const result = await fetchApi<{ run: WorkflowRun; stepRuns: WorkflowStepRun[] }>(`/api/workflow-runs/${runId}`);
  if (!result.success || !result.data) throw new Error(result.error?.message || 'Failed to get run');
  return result.data;
}

export async function cancelWorkflowRun(runId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/workflow-runs/${runId}/cancel`, { method: 'POST' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to cancel run');
}

export async function approveWorkflowStep(stepRunId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/workflow-step-runs/${stepRunId}/approve`, { method: 'POST' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to approve step');
}

export async function rejectWorkflowStep(stepRunId: string): Promise<void> {
  const result = await fetchApi<void>(`/api/workflow-step-runs/${stepRunId}/reject`, { method: 'POST' });
  if (!result.success) throw new Error(result.error?.message || 'Failed to reject step');
}
