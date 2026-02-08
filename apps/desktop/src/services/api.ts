import type {
  Project,
  Session,
  Message,
  ProviderConfig,
  BackendServer,
  SlashCommand,
  ApiResponse,
  DirectoryListingResponse,
  CommandExecuteRequest,
  CommandExecuteResponse,
  ApiKeyInfo,
  ServerInfo,
  ServerGatewayConfig,
  ServerGatewayStatus
} from '@my-claudia/shared';
import { useServerStore } from '../stores/serverStore';
import { useGatewayStore, isGatewayTarget, parseBackendId } from '../stores/gatewayStore';

// Custom error class for authentication errors
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function getBaseUrl(): string {
  const activeId = useServerStore.getState().activeServerId;

  // Gateway target: route through Gateway's HTTP proxy endpoint
  if (isGatewayTarget(activeId)) {
    const backendId = parseBackendId(activeId!);
    const { gatewayUrl } = useGatewayStore.getState();
    if (!gatewayUrl) throw new Error('Gateway not configured');
    const gwAddr = gatewayUrl.includes('://')
      ? gatewayUrl.replace(/^ws/, 'http')
      : `http://${gatewayUrl}`;
    return `${gwAddr}/api/proxy/${backendId}`;
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
function getAuthHeaders(): HeadersInit {
  const activeId = useServerStore.getState().activeServerId;

  // Gateway target: use gatewaySecret:apiKey compound auth
  if (isGatewayTarget(activeId)) {
    const backendId = parseBackendId(activeId!);
    const { gatewaySecret, backendApiKeys } = useGatewayStore.getState();
    const apiKey = backendApiKeys[backendId];
    if (gatewaySecret && apiKey) {
      return {
        'Authorization': `Bearer ${gatewaySecret}:${apiKey}`
      };
    }
    return {};
  }

  // Direct server: use apiKey
  const server = useServerStore.getState().getActiveServer();
  if (!server?.apiKey) {
    return {};
  }
  return {
    'Authorization': `Bearer ${server.apiKey}`
  };
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
  const server = useServerStore.getState().getDefaultServer();
  if (!server?.apiKey) {
    return {};
  }
  return {
    'Authorization': `Bearer ${server.apiKey}`
  };
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
// Projects API
// ============================================

export async function getProjects(): Promise<Project[]> {
  const result = await fetchLocalApi<Project[]>('/api/projects');
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
  const result = await fetchLocalApi<Project>('/api/projects', {
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
  const result = await fetchLocalApi<void>(`/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update project');
  }
}

export async function deleteProject(id: string): Promise<void> {
  const result = await fetchLocalApi<void>(`/api/projects/${id}`, {
    method: 'DELETE'
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete project');
  }
}

// ============================================
// Sessions API
// ============================================

export async function getSessions(projectId?: string): Promise<Session[]> {
  const query = projectId ? `?projectId=${projectId}` : '';
  const result = await fetchLocalApi<Session[]>(`/api/sessions${query}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch sessions');
  }
  return result.data;
}

export async function createSession(data: {
  projectId: string;
  name?: string;
  providerId?: string;
}): Promise<Session> {
  const result = await fetchLocalApi<Session>('/api/sessions', {
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
  const result = await fetchLocalApi<void>(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update session');
  }
}

export async function deleteSession(id: string): Promise<void> {
  const result = await fetchLocalApi<void>(`/api/sessions/${id}`, {
    method: 'DELETE'
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete session');
  }
}

interface PaginationInfo {
  total: number;
  hasMore: boolean;
  oldestTimestamp?: number;
  newestTimestamp?: number;
}

interface MessagesResponse {
  messages: Message[];
  pagination: PaginationInfo;
}

export async function getSessionMessages(
  sessionId: string,
  options?: {
    limit?: number;
    before?: number;
    after?: number;
  }
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', String(options.before));
  if (options?.after) params.set('after', String(options.after));

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
}

export async function searchMessages(query: string, projectId?: string): Promise<SearchResult[]> {
  const params = new URLSearchParams({ q: query });
  if (projectId) params.set('projectId', projectId);

  const result = await fetchApi<{ results: SearchResult[] }>(`/api/sessions/search/messages?${params}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to search messages');
  }
  return result.data.results;
}

// ============================================
// Providers API
// ============================================

export async function getProviders(): Promise<ProviderConfig[]> {
  const result = await fetchLocalApi<ProviderConfig[]>('/api/providers');
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
  const result = await fetchLocalApi<ProviderConfig>('/api/providers', {
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
  const result = await fetchLocalApi<void>(`/api/providers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update provider');
  }
}

export async function deleteProvider(id: string): Promise<void> {
  const result = await fetchLocalApi<void>(`/api/providers/${id}`, {
    method: 'DELETE'
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete provider');
  }
}

export async function setDefaultProvider(id: string): Promise<void> {
  const result = await fetchLocalApi<void>(`/api/providers/${id}/set-default`, {
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
  const result = await fetchLocalApi<SlashCommand[]>(`/api/providers/${providerId}/commands${query}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch provider commands');
  }
  return result.data;
}

export async function getProviderTypeCommands(
  providerType: string,
  projectRoot?: string
): Promise<SlashCommand[]> {
  const query = projectRoot ? `?projectRoot=${encodeURIComponent(projectRoot)}` : '';
  const result = await fetchLocalApi<SlashCommand[]>(`/api/providers/type/${providerType}/commands${query}`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch provider type commands');
  }
  return result.data;
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

/**
 * Verify an API key with a server
 * @param address Server address
 * @param apiKey API key to verify
 * @returns true if the key is valid
 */
export async function verifyApiKey(address: string, apiKey: string): Promise<boolean> {
  const url = address.includes('://') ? address : `http://${address}`;
  try {
    const response = await fetch(`${url}/api/auth/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Get API key info (only works when connected to local server)
 * This endpoint uses localOnlyMiddleware (not authMiddleware), so it doesn't require API Key.
 * We make a direct fetch call without authentication headers to support initial API Key fetch.
 */
export async function getApiKeyInfo(): Promise<ApiKeyInfo> {
  const baseUrl = getLocalBaseUrl();
  const response = await fetch(`${baseUrl}/api/auth/key`, {
    headers: {
      'Content-Type': 'application/json'
    }
  });

  if (response.status === 403) {
    throw new AuthError('Local access only - this endpoint is not available for remote connections');
  }

  const result: ApiResponse<ApiKeyInfo> = await response.json();
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to get API key info');
  }
  return result.data;
}

/**
 * Regenerate API key (only works when connected to local server)
 * This will disconnect all remote clients
 */
export async function regenerateApiKey(): Promise<ApiKeyInfo> {
  const result = await fetchLocalApi<ApiKeyInfo>('/api/auth/key/regenerate', {
    method: 'POST'
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to regenerate API key');
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
