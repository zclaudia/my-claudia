import { fetchApi } from './base';

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
