import { apiCall, apiCallVoid } from './unwrap';
import { useServerStore } from '../../stores/serverStore';
import { parseBackendId } from '../../stores/gatewayStore';
import { resolveCanonicalBackendId, resolveLocalBackendId } from '../../utils/controlPlane';

export interface SearchResult {
  id: string;
  sessionId: string;
  ownerBackendId: string;
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

  const data = await apiCall<{ results: SearchResult[] }>(`/api/sessions/search/messages?${params}`);
  const activeBackendId = resolveSearchOwnerBackendId();
  if (!activeBackendId) {
    throw new Error('No active backend available for search');
  }
  return data.results.map((result) => ({
    ...result,
    ownerBackendId: result.ownerBackendId ?? activeBackendId,
  }));
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

  const data = await apiCall<{ history: SearchHistoryEntry[] }>(`/api/sessions/search/history?${params}`);
  return data.history;
}

export async function clearSearchHistory(userId?: string): Promise<void> {
  const params = new URLSearchParams();
  if (userId) params.set('userId', userId);

  return apiCallVoid(`/api/sessions/search/history?${params}`, { method: 'DELETE' });
}

export async function getSearchSuggestions(prefix: string, userId?: string, limit?: number): Promise<string[]> {
  const params = new URLSearchParams({ prefix });
  if (userId) params.set('userId', userId);
  if (limit) params.set('limit', limit.toString());

  const data = await apiCall<{ suggestions: string[] }>(`/api/sessions/search/suggestions?${params}`);
  return data.suggestions;
}

function resolveSearchOwnerBackendId(): string | null {
  const activeServerId = useServerStore.getState().activeServerId ?? null;
  if (!activeServerId) {
    return resolveLocalBackendId();
  }

  const parsedBackendId = parseBackendId(activeServerId) ?? activeServerId;
  return resolveCanonicalBackendId(parsedBackendId, resolveLocalBackendId() ?? parsedBackendId);
}
