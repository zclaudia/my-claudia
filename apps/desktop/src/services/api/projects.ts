import type { Project, GitWorktree, WorktreeConfig } from '@my-claudia/shared';
import { fetchApi } from './base';

export async function getProjects(options?: RequestInit): Promise<Project[]> {
  const result = await fetchApi<Project[]>('/api/projects', options);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to fetch projects');
  }
  return result.data;
}

export async function createProject(data: {
  name: string;
  type?: 'chat_only' | 'code';
  providerId?: string;
  rootPath?: string;
}): Promise<Project> {
  const result = await fetchApi<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(data)
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create project');
  }
  return result.data;
}

export async function updateProject(
  id: string,
  data: Partial<Project>
): Promise<void> {
  const result = await fetchApi<void>(`/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to update project');
  }
}

export async function deleteProject(id: string): Promise<void> {
  const result = await fetchApi<void>(`/api/projects/${id}`, {
    method: 'DELETE'
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to delete project');
  }
}

export async function getProjectWorktrees(projectId: string): Promise<GitWorktree[]> {
  const result = await fetchApi<GitWorktree[]>(`/api/projects/${projectId}/worktrees`);
  if (!result.success || !result.data) return [];
  return result.data;
}

export async function createProjectWorktree(
  projectId: string,
  branch: string,
  path?: string,
): Promise<GitWorktree> {
  const result = await fetchApi<GitWorktree>(`/api/projects/${projectId}/worktrees`, {
    method: 'POST',
    body: JSON.stringify({ branch, path }),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to create worktree');
  }
  return result.data;
}

export async function getWorktreeConfigs(projectId: string): Promise<WorktreeConfig[]> {
  const result = await fetchApi<WorktreeConfig[]>(`/api/projects/${projectId}/worktree-configs`);
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to list worktree configs');
  }
  return result.data;
}

export async function upsertWorktreeConfig(
  projectId: string,
  config: { worktreePath: string; autoCreatePR: boolean; autoReview: boolean },
): Promise<WorktreeConfig> {
  const result = await fetchApi<WorktreeConfig>(`/api/projects/${projectId}/worktree-configs`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
  if (!result.success || !result.data) {
    throw new Error(result.error?.message || 'Failed to update worktree config');
  }
  return result.data;
}

export async function reorderProjects(orderedIds: string[]): Promise<void> {
  const result = await fetchApi<void>('/api/projects/reorder', {
    method: 'POST',
    body: JSON.stringify({ orderedIds }),
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to reorder projects');
  }
}

export async function setProjectReviewProvider(
  projectId: string,
  providerId: string,
): Promise<void> {
  const result = await fetchApi<void>(`/api/projects/${projectId}/review-provider`, {
    method: 'PATCH',
    body: JSON.stringify({ providerId }),
  });
  if (!result.success) {
    throw new Error(result.error?.message || 'Failed to set review provider');
  }
}
