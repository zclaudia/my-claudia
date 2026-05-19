import type {
  GitWorktreeStatus,
  GitBranch,
  GitCommit,
  GitStash,
} from '@my-claudia/shared';
import { apiCallForBackend, apiCallVoidForBackend } from './unwrap';
import { useOwnershipStore } from '../../stores/ownershipStore';

function ownerOf(projectId: string): string | null {
  return useOwnershipStore.getState().getProjectBackendId(projectId);
}

export async function deleteProjectWorktree(projectId: string, worktreePath: string): Promise<void> {
  return apiCallVoidForBackend(ownerOf(projectId), `/api/projects/${projectId}/worktrees`, {
    method: 'DELETE',
    body: JSON.stringify({ path: worktreePath }),
  });
}

export async function getWorktreeStatus(projectId: string, worktreePath: string): Promise<GitWorktreeStatus> {
  const q = encodeURIComponent(worktreePath);
  return apiCallForBackend<GitWorktreeStatus>(
    ownerOf(projectId),
    `/api/projects/${projectId}/worktrees/status?path=${q}`,
  );
}

export async function getGitBranches(projectId: string, worktreePath: string): Promise<GitBranch[]> {
  const q = encodeURIComponent(worktreePath);
  return apiCallForBackend<GitBranch[]>(
    ownerOf(projectId),
    `/api/projects/${projectId}/git/branches?worktree=${q}`,
  );
}

export interface GitStatusFiles {
  hasChanges: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

export async function getGitStatus(projectId: string, worktreePath: string): Promise<GitStatusFiles> {
  const q = encodeURIComponent(worktreePath);
  return apiCallForBackend<GitStatusFiles>(
    ownerOf(projectId),
    `/api/projects/${projectId}/git/status?worktree=${q}`,
  );
}

export type GitFileDiffKind = 'staged' | 'unstaged' | 'untracked';

export async function getGitFileDiff(
  projectId: string,
  worktreePath: string,
  file: string,
  kind: GitFileDiffKind,
): Promise<{ diff: string }> {
  const worktree = encodeURIComponent(worktreePath);
  const encodedFile = encodeURIComponent(file);
  const encodedKind = encodeURIComponent(kind);
  return apiCallForBackend<{ diff: string }>(
    ownerOf(projectId),
    `/api/projects/${projectId}/git/diff?worktree=${worktree}&file=${encodedFile}&kind=${encodedKind}`,
  );
}

export async function getGitLog(
  projectId: string,
  worktreePath: string,
  limit: number = 50,
): Promise<GitCommit[]> {
  const q = encodeURIComponent(worktreePath);
  return apiCallForBackend<GitCommit[]>(
    ownerOf(projectId),
    `/api/projects/${projectId}/git/log?worktree=${q}&limit=${limit}`,
  );
}

export async function getGitStash(projectId: string, worktreePath: string): Promise<GitStash[]> {
  const q = encodeURIComponent(worktreePath);
  return apiCallForBackend<GitStash[]>(
    ownerOf(projectId),
    `/api/projects/${projectId}/git/stash?worktree=${q}`,
  );
}

export async function createGitStash(
  projectId: string,
  worktreePath: string,
  message?: string,
): Promise<void> {
  return apiCallVoidForBackend(ownerOf(projectId), `/api/projects/${projectId}/git/stash`, {
    method: 'POST',
    body: JSON.stringify({ worktree: worktreePath, message }),
  });
}

export async function applyGitStash(
  projectId: string,
  worktreePath: string,
  index: number,
): Promise<void> {
  return apiCallVoidForBackend(ownerOf(projectId), `/api/projects/${projectId}/git/stash/apply`, {
    method: 'POST',
    body: JSON.stringify({ worktree: worktreePath, index }),
  });
}

export async function dropGitStash(
  projectId: string,
  worktreePath: string,
  index: number,
): Promise<void> {
  return apiCallVoidForBackend(ownerOf(projectId), `/api/projects/${projectId}/git/stash/drop`, {
    method: 'POST',
    body: JSON.stringify({ worktree: worktreePath, index }),
  });
}

export async function stageGitFiles(
  projectId: string,
  worktreePath: string,
  files: string[],
): Promise<void> {
  return apiCallVoidForBackend(ownerOf(projectId), `/api/projects/${projectId}/git/stage`, {
    method: 'POST',
    body: JSON.stringify({ worktree: worktreePath, files }),
  });
}

export async function unstageGitFiles(
  projectId: string,
  worktreePath: string,
  files: string[],
): Promise<void> {
  return apiCallVoidForBackend(ownerOf(projectId), `/api/projects/${projectId}/git/unstage`, {
    method: 'POST',
    body: JSON.stringify({ worktree: worktreePath, files }),
  });
}

export async function commitGit(
  projectId: string,
  worktreePath: string,
  message: string,
): Promise<{ sha: string }> {
  return apiCallForBackend<{ sha: string }>(ownerOf(projectId), `/api/projects/${projectId}/git/commit`, {
    method: 'POST',
    body: JSON.stringify({ worktree: worktreePath, message }),
  });
}

export async function fetchGit(projectId: string, worktreePath: string): Promise<void> {
  return apiCallVoidForBackend(ownerOf(projectId), `/api/projects/${projectId}/git/fetch`, {
    method: 'POST',
    body: JSON.stringify({ worktree: worktreePath }),
  });
}

export async function pullGit(projectId: string, worktreePath: string): Promise<void> {
  return apiCallVoidForBackend(ownerOf(projectId), `/api/projects/${projectId}/git/pull`, {
    method: 'POST',
    body: JSON.stringify({ worktree: worktreePath }),
  });
}

export async function pushGit(
  projectId: string,
  worktreePath: string,
  force: boolean = false,
): Promise<void> {
  return apiCallVoidForBackend(ownerOf(projectId), `/api/projects/${projectId}/git/push`, {
    method: 'POST',
    body: JSON.stringify({ worktree: worktreePath, force }),
  });
}
