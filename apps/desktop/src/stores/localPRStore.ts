import { create } from 'zustand';
import type { LocalPR } from '@my-claudia/shared';
import {
  listLocalPRs,
  createLocalPR,
  closeLocalPR,
  retryLocalPRReview,
  reviewLocalPR,
  mergeLocalPR,
  cancelLocalPRMerge,
  resolveLocalPRConflict,
  reopenLocalPR,
  revertLocalPRMerge,
  setProjectReviewProvider,
} from '../services/api';

interface LocalPRState {
  /** projectId → sorted list of PRs (newest first) */
  prs: Record<string, LocalPR[]>;

  loadPRs: (projectId: string) => Promise<void>;
  createPR: (
    projectId: string,
    worktreePath: string,
    options?: { title?: string; description?: string; baseBranch?: string; autoReview?: boolean },
  ) => Promise<LocalPR>;
  closePR: (prId: string, projectId: string) => Promise<void>;
  retryReview: (prId: string, projectId: string) => Promise<void>;
  reviewPR: (prId: string, projectId: string, providerId?: string) => Promise<void>;
  mergePR: (prId: string, projectId: string) => Promise<void>;
  cancelMergePR: (prId: string, projectId: string) => Promise<void>;
  resolveConflictPR: (prId: string, projectId: string) => Promise<void>;
  reopenPR: (prId: string, projectId: string) => Promise<void>;
  revertMergedPR: (prId: string, projectId: string) => Promise<void>;
  setReviewProvider: (projectId: string, providerId: string) => Promise<void>;

  /** Called from WebSocket handler when a local_pr_update message arrives */
  upsertPR: (projectId: string, pr: LocalPR) => void;
  /** Called from WebSocket handler when a local_pr_deleted message arrives */
  removePR: (projectId: string, prId: string) => void;
}

export const useLocalPRStore = create<LocalPRState>((set, get) => ({
  prs: {},

  loadPRs: async (projectId) => {
    const prs = await listLocalPRs(projectId);
    set((state) => ({ prs: { ...state.prs, [projectId]: prs } }));
  },

  createPR: async (projectId, worktreePath, options) => {
    const pr = await createLocalPR(projectId, worktreePath, options);
    get().upsertPR(projectId, pr);
    return pr;
  },

  closePR: async (prId, projectId) => {
    const pr = await closeLocalPR(prId);
    get().upsertPR(projectId, pr);
  },

  retryReview: async (prId, projectId) => {
    const pr = await retryLocalPRReview(prId);
    get().upsertPR(projectId, pr);
  },

  reviewPR: async (prId, projectId, providerId) => {
    const pr = await reviewLocalPR(prId, providerId);
    get().upsertPR(projectId, pr);
  },

  mergePR: async (prId, projectId) => {
    const pr = await mergeLocalPR(prId);
    get().upsertPR(projectId, pr);
  },

  cancelMergePR: async (prId, projectId) => {
    const pr = await cancelLocalPRMerge(prId);
    get().upsertPR(projectId, pr);
  },

  resolveConflictPR: async (prId, projectId) => {
    const pr = await resolveLocalPRConflict(prId);
    get().upsertPR(projectId, pr);
  },

  reopenPR: async (prId, projectId) => {
    const pr = await reopenLocalPR(prId);
    get().upsertPR(projectId, pr);
  },

  revertMergedPR: async (prId, projectId) => {
    const pr = await revertLocalPRMerge(prId);
    get().upsertPR(projectId, pr);
  },

  setReviewProvider: async (projectId, providerId) => {
    await setProjectReviewProvider(projectId, providerId);
  },

  upsertPR: (projectId, pr) =>
    set((state) => {
      const existing = state.prs[projectId] ?? [];
      const idx = existing.findIndex((p) => p.id === pr.id);
      const updated =
        idx >= 0 ? existing.map((p, i) => (i === idx ? pr : p)) : [pr, ...existing];
      return { prs: { ...state.prs, [projectId]: updated } };
    }),

  removePR: (projectId, prId) =>
    set((state) => {
      const existing = state.prs[projectId] ?? [];
      return { prs: { ...state.prs, [projectId]: existing.filter((p) => p.id !== prId) } };
    }),
}));
