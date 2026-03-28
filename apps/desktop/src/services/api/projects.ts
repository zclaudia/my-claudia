import type { Project, GitWorktree, WorktreeConfig } from '@my-claudia/shared';
import { fetchApiForBackend } from './base';
import { apiCall, apiCallForBackend, apiCallVoid, apiCallVoidForBackend } from './unwrap';
import { useOwnershipStore } from '../../stores/ownershipStore';

function getProjectOwnerBackendId(projectId: string): string | null {
  return useOwnershipStore.getState().getProjectBackendId(projectId);
}

export async function getProjects(options?: RequestInit): Promise<Project[]> {
  return apiCall<Project[]>('/api/projects', options);
}

export async function createProject(data: {
  name: string;
  type?: 'chat_only' | 'code';
  providerId?: string;
  rootPath?: string;
}): Promise<Project> {
  return apiCall<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function updateProject(
  id: string,
  data: Partial<Project>
): Promise<void> {
  return apiCallVoidForBackend(getProjectOwnerBackendId(id), `/api/projects/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data)
  });
}

export async function deleteProject(id: string): Promise<void> {
  return apiCallVoidForBackend(getProjectOwnerBackendId(id), `/api/projects/${id}`, { method: 'DELETE' });
}

export async function getProjectWorktrees(projectId: string): Promise<GitWorktree[]> {
  // Special: returns [] on failure instead of throwing
  const result = await fetchApiForBackend<GitWorktree[]>(
    `/api/projects/${projectId}/worktrees`,
    getProjectOwnerBackendId(projectId)
  );
  if (!result.success || !result.data) return [];
  return result.data;
}

export async function createProjectWorktree(
  projectId: string,
  branch: string,
  path?: string,
): Promise<GitWorktree> {
  return apiCallForBackend<GitWorktree>(getProjectOwnerBackendId(projectId), `/api/projects/${projectId}/worktrees`, {
    method: 'POST',
    body: JSON.stringify({ branch, path }),
  });
}

export async function getWorktreeConfigs(projectId: string): Promise<WorktreeConfig[]> {
  return apiCallForBackend<WorktreeConfig[]>(getProjectOwnerBackendId(projectId), `/api/projects/${projectId}/worktree-configs`);
}

export async function upsertWorktreeConfig(
  projectId: string,
  config: { worktreePath: string; autoCreatePR: boolean; autoReview: boolean },
): Promise<WorktreeConfig> {
  return apiCallForBackend<WorktreeConfig>(getProjectOwnerBackendId(projectId), `/api/projects/${projectId}/worktree-configs`, {
    method: 'PUT',
    body: JSON.stringify(config),
  });
}

export async function reorderProjects(orderedIds: string[]): Promise<void> {
  return apiCallVoid('/api/projects/reorder', {
    method: 'POST',
    body: JSON.stringify({ orderedIds }),
  });
}

export async function setProjectReviewProvider(
  projectId: string,
  providerId: string,
): Promise<void> {
  return apiCallVoidForBackend(getProjectOwnerBackendId(projectId), `/api/projects/${projectId}/review-provider`, {
    method: 'PATCH',
    body: JSON.stringify({ providerId }),
  });
}
