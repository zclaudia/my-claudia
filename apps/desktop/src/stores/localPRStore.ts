import { create } from 'zustand';
import type { LocalPR } from '@my-claudia/shared';
import {
  listLocalPRs,
  createLocalPR,
  closeLocalPR,
  retryLocalPRReview,
  mergeLocalPR,
  setProjectReviewProvider,
} from '../services/api';

interface LocalPRState {
  /** projectId → sorted list of PRs (newest first) */
  prs: Record<string, LocalPR[]>;

  loadPRs: (projectId: string) => Promise<void>;
  createPR: (
    projectId: string,
    worktreePath: string,
    options?: { title?: string; description?: string },
  ) => Promise<LocalPR>;
  closePR: (prId: string, projectId: string) => Promise<void>;
  retryReview: (prId: string, projectId: string) => Promise<void>;
  mergePR: (prId: string, projectId: string) => Promise<void>;
  setReviewProvider: (projectId: string, providerId: string) => Promise<void>;

  /** Called from WebSocket handler when a local_pr_update message arrives */
  upsertPR: (projectId: string, pr: LocalPR) => void;
}

export const useLocalPRStore = create<LocalPRState>((set, get) => ({
  prs: {},

  loadPRs: async (projectId) => {
    const prs = await listLocalPRs(projectId);
    set((state) => ({ prs: { ...state.prs, [projectId]: prs } }));
  },

  createPR: async (projectId, worktreePath, options) => {
    const pr = await createLocalPR(projectId, worktreePath, options);
    set((state) => {
      const existing = state.prs[projectId] ?? [];
      return { prs: { ...state.prs, [projectId]: [pr, ...existing] } };
    });
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

  mergePR: async (prId, projectId) => {
    const pr = await mergeLocalPR(prId);
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
}));
