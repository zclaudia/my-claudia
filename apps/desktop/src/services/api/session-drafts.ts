import type { SessionDraft } from '@my-claudia/shared';
import { fetchApiForBackend } from './base';
import { apiCallForBackend, apiCallVoidForBackend } from './unwrap';
import { useOwnershipStore } from '../../stores/ownershipStore';

function getBackendIdForSession(sessionId: string): string | null {
  return useOwnershipStore.getState().getSessionBackendId(sessionId);
}

export async function getSessionDraft(sessionId: string): Promise<SessionDraft | null> {
  // Special: returns null on failure instead of throwing
  const result = await fetchApiForBackend<SessionDraft | null>(
    `/api/sessions/${sessionId}/draft`,
    getBackendIdForSession(sessionId),
  );
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
  return apiCallForBackend<SessionDraft>(getBackendIdForSession(sessionId), `/api/sessions/${sessionId}/draft`, {
    method: 'PUT',
    body: JSON.stringify({ content, deviceId }),
  });
}

export async function lockSessionDraft(
  sessionId: string,
  deviceId: string,
  force?: boolean
): Promise<{ locked: boolean; draft: SessionDraft | null }> {
  return apiCallForBackend<{ locked: boolean; draft: SessionDraft | null }>(
    getBackendIdForSession(sessionId),
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
  await fetchApiForBackend(`/api/sessions/${sessionId}/draft/unlock`, getBackendIdForSession(sessionId), {
    method: 'POST',
    body: JSON.stringify({ deviceId }),
  });
}

export async function archiveSessionDraft(sessionId: string): Promise<void> {
  return apiCallVoidForBackend(getBackendIdForSession(sessionId), `/api/sessions/${sessionId}/draft/archive`, { method: 'POST' });
}

export async function deleteSessionDraft(sessionId: string): Promise<void> {
  return apiCallVoidForBackend(getBackendIdForSession(sessionId), `/api/sessions/${sessionId}/draft`, { method: 'DELETE' });
}
