import type { Session, Message } from '@my-claudia/shared';
import { fetchApi } from './base';
import { apiCall, apiCallVoid } from './unwrap';

export async function getSessions(projectId?: string, options?: RequestInit): Promise<Session[]> {
  const query = projectId ? `?projectId=${projectId}` : '';
  return apiCall<Session[]>(`/api/sessions${query}`, options);
}

export async function reorderSessions(projectId: string, orderedIds: string[]): Promise<void> {
  return apiCallVoid('/api/sessions/reorder', {
    method: 'POST',
    body: JSON.stringify({ projectId, orderedIds }),
  });
}

export async function getSessionRunState(sessionId: string): Promise<{ sessionId: string; isRunning: boolean; activeRunId?: string }> {
  return apiCall<{ sessionId: string; isRunning: boolean; activeRunId?: string }>(`/api/sessions/${sessionId}/run-state`);
}

export async function createSession(data: {
  projectId: string;
  name?: string;
  providerId?: string;
  type?: import('@my-claudia/shared').SessionType;
  parentSessionId?: string;
  workingDirectory?: string;
}): Promise<Session> {
  return apiCall<Session>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateSession(
  id: string,
  data: Partial<Session>
): Promise<void> {
  return apiCallVoid(`/api/sessions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function updateSessionWorkingDirectory(
  sessionId: string,
  workingDirectory: string
): Promise<Session> {
  return apiCall<Session>(`/api/sessions/${sessionId}/working-directory`, {
    method: 'PATCH',
    body: JSON.stringify({ workingDirectory })
  });
}

export async function resetSessionSdkSession(sessionId: string): Promise<void> {
  return apiCallVoid(`/api/sessions/${sessionId}/reset-sdk-session`, { method: 'POST' });
}

export async function dismissInterrupted(sessionId: string): Promise<void> {
  // Fire-and-forget, no error check
  await fetchApi(`/api/sessions/${sessionId}/dismiss-interrupted`, { method: 'PATCH' });
}

export async function unlockSession(sessionId: string): Promise<Session> {
  return apiCall<Session>(`/api/sessions/${sessionId}/unlock`, { method: 'PATCH' });
}

export async function deleteSession(id: string): Promise<void> {
  return apiCallVoid(`/api/sessions/${id}`, { method: 'DELETE' });
}

export async function archiveSessions(sessionIds: string[]): Promise<void> {
  return apiCallVoid('/api/sessions/archive', {
    method: 'POST',
    body: JSON.stringify({ sessionIds })
  });
}

export async function restoreSessions(sessionIds: string[]): Promise<void> {
  return apiCallVoid('/api/sessions/restore', {
    method: 'POST',
    body: JSON.stringify({ sessionIds })
  });
}

export async function getArchivedSessions(): Promise<Session[]> {
  return apiCall<Session[]>('/api/sessions/archived');
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
  return apiCall<MessagesResponse>(`/api/sessions/${sessionId}/messages${query}`, {
    signal: options?.signal,
  });
}

export async function exportSession(sessionId: string): Promise<{ markdown: string; sessionName: string }> {
  return apiCall<{ markdown: string; sessionName: string }>(`/api/sessions/${sessionId}/export`);
}
