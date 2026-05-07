import { create } from 'zustand';
import type { LocalIssue } from '@my-claudia/shared';
import {
  listLocalIssues,
  createLocalIssue,
  updateLocalIssue,
  closeLocalIssue,
  reopenLocalIssue,
  deleteLocalIssue,
} from './api';

interface LocalIssueState {
  issues: Record<string, LocalIssue[]>;
  loadIssues: (projectId: string) => Promise<void>;
  createIssue: (
    projectId: string,
    data: { title: string; description?: string; priority?: string; labels?: string[] },
  ) => Promise<LocalIssue>;
  updateIssue: (
    issueId: string,
    projectId: string,
    data: { title?: string; description?: string; priority?: string; labels?: string[]; status?: string },
  ) => Promise<void>;
  closeIssue: (issueId: string, projectId: string) => Promise<void>;
  reopenIssue: (issueId: string, projectId: string) => Promise<void>;
  deleteIssue: (issueId: string, projectId: string) => Promise<void>;
  upsertIssue: (projectId: string, issue: LocalIssue) => void;
  removeIssue: (projectId: string, issueId: string) => void;
}

export const useLocalIssueStore = create<LocalIssueState>((set, get) => ({
  issues: {},

  loadIssues: async (projectId) => {
    const issues = await listLocalIssues(projectId);
    set((state) => ({ issues: { ...state.issues, [projectId]: issues } }));
  },

  createIssue: async (projectId, data) => {
    const issue = await createLocalIssue(projectId, data);
    get().upsertIssue(projectId, issue);
    return issue;
  },

  updateIssue: async (issueId, projectId, data) => {
    const issue = await updateLocalIssue(issueId, data);
    get().upsertIssue(projectId, issue);
  },

  closeIssue: async (issueId, projectId) => {
    const issue = await closeLocalIssue(issueId);
    get().upsertIssue(projectId, issue);
  },

  reopenIssue: async (issueId, projectId) => {
    const issue = await reopenLocalIssue(issueId);
    get().upsertIssue(projectId, issue);
  },

  deleteIssue: async (issueId, projectId) => {
    await deleteLocalIssue(issueId);
    get().removeIssue(projectId, issueId);
  },

  upsertIssue: (projectId, issue) =>
    set((state) => {
      const existing = state.issues[projectId] ?? [];
      const idx = existing.findIndex((i) => i.id === issue.id);
      const updated =
        idx >= 0 ? existing.map((i, n) => (n === idx ? issue : i)) : [issue, ...existing];
      return { issues: { ...state.issues, [projectId]: updated } };
    }),

  removeIssue: (projectId, issueId) =>
    set((state) => {
      const existing = state.issues[projectId] ?? [];
      return { issues: { ...state.issues, [projectId]: existing.filter((i) => i.id !== issueId) } };
    }),
}));
