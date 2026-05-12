import type { LocalIssue, LocalIssueComment } from '@my-claudia/shared';
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

// ── Comments ────────────────────────────────────────────────────────────────

export async function listIssueComments(issueId: string): Promise<LocalIssueComment[]> {
  return apiCall<LocalIssueComment[]>(`/api/local-issues/${issueId}/comments`);
}

export async function createIssueComment(issueId: string, body: string): Promise<LocalIssueComment> {
  return apiCall<LocalIssueComment>(`/api/local-issues/${issueId}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body }),
  });
}

export async function updateIssueComment(commentId: string, body: string): Promise<LocalIssueComment> {
  return apiCall<LocalIssueComment>(`/api/local-issue-comments/${commentId}`, {
    method: 'PATCH',
    body: JSON.stringify({ body }),
  });
}

export async function deleteIssueComment(commentId: string): Promise<void> {
  await apiCall<null>(`/api/local-issue-comments/${commentId}`, { method: 'DELETE' });
}
