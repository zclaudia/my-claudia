import type { SessionDraft } from '@my-claudia/shared';
import { fetchApi } from './base';

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

export async function deleteSessionDraft(sessionId: string): Promise<void> {
  const result = await fetchApi(`/api/sessions/${sessionId}/draft`, {
    method: 'DELETE',
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete draft');
  }
}
