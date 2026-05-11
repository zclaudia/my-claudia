import type {
  TurnSummary,
  GenerateTurnSummaryRequest,
  GenerateTurnSummaryResponse,
} from '@my-claudia/shared';
import { apiCallForBackend } from './unwrap';
import { useOwnershipStore } from '../../stores/ownershipStore';

function getBackendIdForSession(sessionId: string): string | null {
  return useOwnershipStore.getState().getSessionBackendId(sessionId);
}

export async function listTurnSummaries(sessionId: string): Promise<TurnSummary[]> {
  return apiCallForBackend<TurnSummary[]>(
    getBackendIdForSession(sessionId),
    `/api/sessions/${sessionId}/turn-summaries`,
  );
}

export async function generateTurnSummary(
  sessionId: string,
  userMessageId: string,
  body: GenerateTurnSummaryRequest = {},
): Promise<GenerateTurnSummaryResponse> {
  return apiCallForBackend<GenerateTurnSummaryResponse>(
    getBackendIdForSession(sessionId),
    `/api/sessions/${sessionId}/turn-summaries/${encodeURIComponent(userMessageId)}/generate`,
    {
      method: 'POST',
      body: JSON.stringify(body),
    },
  );
}
