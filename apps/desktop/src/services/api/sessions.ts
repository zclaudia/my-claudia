import type { Session, Message } from '@my-claudia/shared';
import { fetchApi } from './base';

export async function getSessions(projectId?: string, options?: RequestInit): Promise<Session[]> {
  const query = projectId ? `?projectId=${projectId}` : '';
  const result = await fetchApi<Session[]>(`/api/sessions${query}`, options);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch sessions');
  }
  return result.data;
}

export async function reorderSessions(projectId: string, orderedIds: string[]): Promise<void> {
  const result = await fetchApi<void>('/api/sessions/reorder', {
    method: 'POST',
    body: JSON.stringify({ projectId, orderedIds }),
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to reorder sessions');
  }
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
  type?: import('@my-claudia/shared').SessionType;
  parentSessionId?: string;
  workingDirectory?: string;
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
): Promise<Session> {
  const result = await fetchApi<Session>(`/api/sessions/${sessionId}/working-directory`, {
    method: 'PATCH',
    body: JSON.stringify({ workingDirectory })
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update working directory');
  }
  return result.data;
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
    aroundMessageId?: string;
    signal?: AbortSignal;
  }
): Promise<MessagesResponse> {
  const params = new URLSearchParams();
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.before) params.set('before', String(options.before));
  if (options?.after) params.set('after', String(options.after));
  if (options?.afterOffset != null) params.set('afterOffset', String(options.afterOffset));
  if (options?.aroundMessageId) params.set('aroundMessageId', options.aroundMessageId);

  const query = params.toString() ? `?${params.toString()}` : '';
  const result = await fetchApi<MessagesResponse>(`/api/sessions/${sessionId}/messages${query}`, {
    signal: options?.signal,
  });

  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch messages');
  }
  return result.data;
}

export async function exportSession(sessionId: string): Promise<{ markdown: string; sessionName: string }> {
  const result = await fetchApi<{ markdown: string; sessionName: string }>(`/api/sessions/${sessionId}/export`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to export session');
  }
  return result.data;
}
