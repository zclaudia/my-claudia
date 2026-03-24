import type { SessionDraft } from '@my-claudia/shared';
import { fetchApi } from './base';
import { apiCall, apiCallVoid } from './unwrap';

export async function getSessionDraft(sessionId: string): Promise<SessionDraft | null> {
  // Special: returns null on failure instead of throwing
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
  return apiCall<SessionDraft>(`/api/sessions/${sessionId}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ content, deviceId }),
  });
}

export async function lockSessionDraft(
  sessionId: string,
  deviceId: string,
  force?: boolean
): Promise<{ locked: boolean; draft: SessionDraft | null }> {
  return apiCall<{ locked: boolean; draft: SessionDraft | null }>(
    `/api/sessions/${sessionId}/draft/lock`,
    {
      method: 'POST',
      body: JSON.stringify({ deviceId, force }),
    }
  );
}

export async function unlockSessionDraft(
  sessionId: string,
  deviceId: string
): Promise<void> {
  // Fire-and-forget, no error check
  await fetchApi(`/api/sessions/${sessionId}/draft/unlock`, {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
}

export async function archiveSessionDraft(sessionId: string): Promise<void> {
  return apiCallVoid(`/api/sessions/${sessionId}/draft/archive`, { method: 'POST' });
}

export async function deleteSessionDraft(sessionId: string): Promise<void> {
  return apiCallVoid(`/api/sessions/${sessionId}/draft`, { method: 'DELETE' });
}
