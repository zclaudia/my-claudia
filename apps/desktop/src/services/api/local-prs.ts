import type { LocalPR } from '@my-claudia/shared';
import { fetchApi } from './base';

export async function listLocalPRs(projectId: string): Promise<LocalPR[]> {
  const result = await fetchApi<LocalPR[]>(`/api/projects/${projectId}/local-prs`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to list local PRs');
  }
  return result.data;
}

export async function createLocalPR(
  projectId: string,
  worktreePath: string,
  options?: { title?: string; description?: string; baseBranch?: string; autoReview?: boolean },
): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/projects/${projectId}/local-prs`, {
    method: 'POST',
    body: JSON.stringify({ worktreePath, ...options }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create local PR');
  }
  return result.data;
}

export async function precheckLocalPRCreation(
  projectId: string,
  worktreePath: string,
): Promise<{ canCreate: boolean; reason?: string }> {
  const params = new URLSearchParams({ worktreePath });
  const result = await fetchApi<{ canCreate: boolean; reason?: string }>(
    `/api/projects/${projectId}/local-prs/precheck?${params.toString()}`
  );
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to check PR eligibility');
  }
  return result.data;
}

export async function closeLocalPR(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/close`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to close local PR');
  }
  return result.data;
}

export async function retryLocalPRReview(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/retry-review`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to retry review');
  }
  return result.data;
}

export async function reviewLocalPR(prId: string, providerId?: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/review`, {
    method: 'POST',
    body: JSON.stringify({ providerId }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to start review');
  }
  return result.data;
}

export async function mergeLocalPR(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/merge`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to merge local PR');
  }
  return result.data;
}

export async function cancelLocalPRMerge(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/cancel-merge`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to cancel merge');
  }
  return result.data;
}

export async function resolveLocalPRConflict(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/resolve-conflict`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to start AI conflict resolution');
  }
  return result.data;
}

export async function reopenLocalPR(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/reopen`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to reopen PR');
  }
  return result.data;
}

export async function revertLocalPRMerge(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/revert-merge`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to revert merged PR');
  }
  return result.data;
}

export async function cancelLocalPRQueue(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/cancel-queue`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to cancel queue');
  }
  return result.data;
}

export async function retryLocalPR(prId: string): Promise<LocalPR> {
  const result = await fetchApi<LocalPR>(`/api/local-prs/${prId}/retry`, { method: 'POST' });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to retry');
  }
  return result.data;
}
