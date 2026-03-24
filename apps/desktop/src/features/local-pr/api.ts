import type { LocalPR } from '@my-claudia/shared';
import { apiCall } from '../../services/api/unwrap';

export async function listLocalPRs(projectId: string): Promise<LocalPR[]> {
  return apiCall<LocalPR[]>(`/api/projects/${projectId}/local-prs`);
}

export async function createLocalPR(
  projectId: string,
  worktreePath: string,
  options?: { title?: string; description?: string; baseBranch?: string; autoReview?: boolean },
): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/projects/${projectId}/local-prs`, {
    method: 'POST',
    body: JSON.stringify({ worktreePath, ...options }),
  });
}

export async function precheckLocalPRCreation(
  projectId: string,
  worktreePath: string,
): Promise<{ canCreate: boolean; reason?: string }> {
  const params = new URLSearchParams({ worktreePath });
  return apiCall<{ canCreate: boolean; reason?: string }>(
    `/api/projects/${projectId}/local-prs/precheck?${params.toString()}`
  );
}

export async function closeLocalPR(prId: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/close`, { method: 'POST' });
}

export async function retryLocalPRReview(prId: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/retry-review`, { method: 'POST' });
}

export async function reviewLocalPR(prId: string, providerId?: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/review`, {
    method: 'POST',
    body: JSON.stringify({ providerId }),
  });
}

export async function mergeLocalPR(prId: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/merge`, { method: 'POST' });
}

export async function cancelLocalPRMerge(prId: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/cancel-merge`, { method: 'POST' });
}

export async function resolveLocalPRConflict(prId: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/resolve-conflict`, { method: 'POST' });
}

export async function reopenLocalPR(prId: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/reopen`, { method: 'POST' });
}

export async function revertLocalPRMerge(prId: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/revert-merge`, { method: 'POST' });
}

export async function cancelLocalPRQueue(prId: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/cancel-queue`, { method: 'POST' });
}

export async function retryLocalPR(prId: string): Promise<LocalPR> {
  return apiCall<LocalPR>(`/api/local-prs/${prId}/retry`, { method: 'POST' });
}
