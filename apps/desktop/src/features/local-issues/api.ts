import type { LocalIssue } from '@my-claudia/shared';
import { apiCall } from '../../services/api/unwrap';

export async function listLocalIssues(projectId: string): Promise<LocalIssue[]> {
  return apiCall<LocalIssue[]>(`/api/projects/${projectId}/local-issues`);
}

export async function createLocalIssue(
  projectId: string,
  data: { title: string; description?: string; priority?: string; labels?: string[] },
): Promise<LocalIssue> {
  return apiCall<LocalIssue>(`/api/projects/${projectId}/local-issues`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export async function updateLocalIssue(
  issueId: string,
  data: { title?: string; description?: string; priority?: string; labels?: string[]; status?: string },
): Promise<LocalIssue> {
  return apiCall<LocalIssue>(`/api/local-issues/${issueId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function closeLocalIssue(issueId: string): Promise<LocalIssue> {
  return apiCall<LocalIssue>(`/api/local-issues/${issueId}/close`, { method: 'POST' });
}

export async function reopenLocalIssue(issueId: string): Promise<LocalIssue> {
  return apiCall<LocalIssue>(`/api/local-issues/${issueId}/reopen`, { method: 'POST' });
}

export async function deleteLocalIssue(issueId: string): Promise<void> {
  await apiCall<null>(`/api/local-issues/${issueId}`, { method: 'DELETE' });
}
