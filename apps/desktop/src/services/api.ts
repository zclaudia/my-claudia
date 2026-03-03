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
  ServerFeature
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

async function fetchLocalApi<T>(
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
// Supervisions API — routes to active server
// ============================================

import type { Supervision, SupervisionLog, SupervisionPlan } from '@my-claudia/shared';

export async function startSupervisionPlanning(data: {
  sessionId: string;
  hint: string;
}): Promise<{ supervision: Supervision }> {
  const result = await fetchApi<{ supervision: Supervision }>('/api/supervisions/plan/start', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to start planning');
  }
  return result.data;
}

export async function approvePlan(
  supervisionId: string,
  plan: SupervisionPlan & { maxIterations?: number; cooldownSeconds?: number }
): Promise<Supervision> {
  const result = await fetchApi<Supervision>(`/api/supervisions/plan/${supervisionId}/approve`, {
    method: 'POST',
    body: JSON.stringify(plan),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to approve plan');
  }
  return result.data;
}

export async function cancelPlanning(supervisionId: string): Promise<Supervision> {
  const result = await fetchApi<Supervision>(`/api/supervisions/plan/${supervisionId}/cancel`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to cancel planning');
  }
  return result.data;
}

export async function createSupervision(data: {
  sessionId: string;
  goal: string;
  subtasks?: string[];
  maxIterations?: number;
  cooldownSeconds?: number;
}): Promise<Supervision> {
  const result = await fetchApi<Supervision>('/api/supervisions', {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create supervision');
  }
  return result.data;
}

export async function getSupervisions(): Promise<Supervision[]> {
  const result = await fetchApi<Supervision[]>('/api/supervisions');
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch supervisions');
  }
  return result.data;
}

export async function getSupervisionBySession(sessionId: string): Promise<Supervision | null> {
  const result = await fetchApi<Supervision | null>(`/api/supervisions/session/${sessionId}`);
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to get supervision');
  }
  return result.data ?? null;
}

export async function getSupervisionLogs(id: string): Promise<SupervisionLog[]> {
  const result = await fetchApi<SupervisionLog[]>(`/api/supervisions/${id}/logs`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get supervision logs');
  }
  return result.data;
}

export async function pauseSupervision(id: string): Promise<Supervision> {
  const result = await fetchApi<Supervision>(`/api/supervisions/${id}/pause`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to pause supervision');
  }
  return result.data;
}

export async function resumeSupervision(id: string, options?: { maxIterations?: number }): Promise<Supervision> {
  const result = await fetchApi<Supervision>(`/api/supervisions/${id}/resume`, {
    method: 'POST',
    body: JSON.stringify(options || {}),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to resume supervision');
  }
  return result.data;
}

export async function cancelSupervision(id: string): Promise<Supervision> {
  const result = await fetchApi<Supervision>(`/api/supervisions/${id}/cancel`, {
    method: 'POST',
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to cancel supervision');
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
