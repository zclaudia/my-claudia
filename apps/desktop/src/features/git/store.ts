import { create } from 'zustand';
import type {
  GitWorktree,
  GitWorktreeStatus,
  GitBranch,
  GitCommit,
  GitStash,
} from '@my-claudia/shared';

interface GitState {
  // Per-project worktrees
  worktrees: Record<string, GitWorktree[]>;
  // Per-project selected worktree path
  selectedWorktree: Record<string, string | null>;
  // Per-worktree-path cached data (key is `${projectId}::${worktreePath}`)
  statusByPath: Record<string, GitWorktreeStatus>;
  branchesByPath: Record<string, GitBranch[]>;
  logByPath: Record<string, GitCommit[]>;
  stashByPath: Record<string, GitStash[]>;

  setWorktrees: (projectId: string, worktrees: GitWorktree[]) => void;
  removeWorktreeFromCache: (projectId: string, worktreePath: string) => void;
  setSelectedWorktree: (projectId: string, worktreePath: string | null) => void;
  setStatus: (projectId: string, worktreePath: string, status: GitWorktreeStatus) => void;
  setBranches: (projectId: string, worktreePath: string, branches: GitBranch[]) => void;
  setLog: (projectId: string, worktreePath: string, log: GitCommit[]) => void;
  setStash: (projectId: string, worktreePath: string, stash: GitStash[]) => void;
}

const cacheKey = (projectId: string, worktreePath: string) => `${projectId}::${worktreePath}`;

export const useGitStore = create<GitState>((set) => ({
  worktrees: {},
  selectedWorktree: {},
  statusByPath: {},
  branchesByPath: {},
  logByPath: {},
  stashByPath: {},

  setWorktrees: (projectId, worktrees) =>
    set((s) => ({ worktrees: { ...s.worktrees, [projectId]: worktrees } })),

  removeWorktreeFromCache: (projectId, worktreePath) =>
    set((s) => {
      const list = (s.worktrees[projectId] ?? []).filter((w) => w.path !== worktreePath);
      const key = cacheKey(projectId, worktreePath);
      const { [key]: _s, ...status } = s.statusByPath;
      const { [key]: _b, ...branches } = s.branchesByPath;
      const { [key]: _l, ...log } = s.logByPath;
      const { [key]: _t, ...stash } = s.stashByPath;
      void _s; void _b; void _l; void _t;
      const selected = s.selectedWorktree[projectId];
      const nextSelected = { ...s.selectedWorktree };
      if (selected === worktreePath) nextSelected[projectId] = null;
      return {
        worktrees: { ...s.worktrees, [projectId]: list },
        statusByPath: status,
        branchesByPath: branches,
        logByPath: log,
        stashByPath: stash,
        selectedWorktree: nextSelected,
      };
    }),

  setSelectedWorktree: (projectId, worktreePath) =>
    set((s) => ({ selectedWorktree: { ...s.selectedWorktree, [projectId]: worktreePath } })),

  setStatus: (projectId, worktreePath, status) =>
    set((s) => ({ statusByPath: { ...s.statusByPath, [cacheKey(projectId, worktreePath)]: status } })),

  setBranches: (projectId, worktreePath, branches) =>
    set((s) => ({ branchesByPath: { ...s.branchesByPath, [cacheKey(projectId, worktreePath)]: branches } })),

  setLog: (projectId, worktreePath, log) =>
    set((s) => ({ logByPath: { ...s.logByPath, [cacheKey(projectId, worktreePath)]: log } })),

  setStash: (projectId, worktreePath, stash) =>
    set((s) => ({ stashByPath: { ...s.stashByPath, [cacheKey(projectId, worktreePath)]: stash } })),
}));

export function selectStatus(projectId: string, worktreePath: string) {
  return (s: GitState): GitWorktreeStatus | undefined =>
    s.statusByPath[cacheKey(projectId, worktreePath)];
}

export function selectBranches(projectId: string, worktreePath: string) {
  return (s: GitState): GitBranch[] | undefined =>
    s.branchesByPath[cacheKey(projectId, worktreePath)];
}

export function selectLog(projectId: string, worktreePath: string) {
  return (s: GitState): GitCommit[] | undefined =>
    s.logByPath[cacheKey(projectId, worktreePath)];
}

export function selectStash(projectId: string, worktreePath: string) {
  return (s: GitState): GitStash[] | undefined =>
    s.stashByPath[cacheKey(projectId, worktreePath)];
}
