import { create } from 'zustand';
import type { LocalIssueComment } from '@my-claudia/shared';
import {
  listIssueComments,
  createIssueComment,
  updateIssueComment,
  deleteIssueComment,
} from './api';

interface CommentsState {
  /** Comments keyed by issueId, sorted ASC by createdAt. */
  comments: Record<string, LocalIssueComment[]>;
  /** True while the first load for an issue is in flight. */
  loading: Record<string, boolean>;
  /** Set of issueIds already loaded — second loadComments calls are no-ops. */
  loaded: Set<string>;

  loadComments: (issueId: string) => Promise<void>;
  refreshComments: (issueId: string) => Promise<void>;
  addComment: (issueId: string, body: string) => Promise<LocalIssueComment>;
  editComment: (commentId: string, body: string) => Promise<LocalIssueComment>;
  removeComment: (commentId: string) => Promise<void>;

  // Server-push channel — called by handlers when broadcasts arrive.
  upsertComment: (comment: LocalIssueComment) => void;
  deleteCommentLocal: (issueId: string, commentId: string) => void;
  /** Drop everything for an issue — used when the issue itself is deleted. */
  clearIssue: (issueId: string) => void;
}

function sortComments(list: LocalIssueComment[]): LocalIssueComment[] {
  return [...list].sort((a, b) => a.createdAt - b.createdAt);
}

export const useLocalIssueCommentStore = create<CommentsState>((set, get) => ({
  comments: {},
  loading: {},
  loaded: new Set(),

  loadComments: async (issueId) => {
    if (get().loaded.has(issueId)) return;
    if (get().loading[issueId]) return;
    set((s) => ({ loading: { ...s.loading, [issueId]: true } }));
    try {
      const list = await listIssueComments(issueId);
      set((s) => {
        const nextLoaded = new Set(s.loaded);
        nextLoaded.add(issueId);
        return {
          comments: { ...s.comments, [issueId]: sortComments(list) },
          loading: { ...s.loading, [issueId]: false },
          loaded: nextLoaded,
        };
      });
    } catch (err) {
      set((s) => ({ loading: { ...s.loading, [issueId]: false } }));
      throw err;
    }
  },

  refreshComments: async (issueId) => {
    set((s) => ({ loading: { ...s.loading, [issueId]: true } }));
    try {
      const list = await listIssueComments(issueId);
      set((s) => {
        const nextLoaded = new Set(s.loaded);
        nextLoaded.add(issueId);
        return {
          comments: { ...s.comments, [issueId]: sortComments(list) },
          loading: { ...s.loading, [issueId]: false },
          loaded: nextLoaded,
        };
      });
    } catch (err) {
      set((s) => ({ loading: { ...s.loading, [issueId]: false } }));
      throw err;
    }
  },

  addComment: async (issueId, body) => {
    const created = await createIssueComment(issueId, body);
    get().upsertComment(created);
    return created;
  },

  editComment: async (commentId, body) => {
    const updated = await updateIssueComment(commentId, body);
    get().upsertComment(updated);
    return updated;
  },

  removeComment: async (commentId) => {
    // Find the issue id from any list so the local delete works even if the
    // WS broadcast hasn't arrived yet.
    let foundIssueId: string | null = null;
    for (const [iid, list] of Object.entries(get().comments)) {
      if (list.some((c) => c.id === commentId)) { foundIssueId = iid; break; }
    }
    await deleteIssueComment(commentId);
    if (foundIssueId) get().deleteCommentLocal(foundIssueId, commentId);
  },

  upsertComment: (comment) => {
    set((s) => {
      const existing = s.comments[comment.issueId] ?? [];
      const idx = existing.findIndex((c) => c.id === comment.id);
      const next = idx >= 0
        ? existing.map((c) => (c.id === comment.id ? comment : c))
        : [...existing, comment];
      return { comments: { ...s.comments, [comment.issueId]: sortComments(next) } };
    });
  },

  deleteCommentLocal: (issueId, commentId) => {
    set((s) => {
      const existing = s.comments[issueId];
      if (!existing) return s;
      return {
        comments: {
          ...s.comments,
          [issueId]: existing.filter((c) => c.id !== commentId),
        },
      };
    });
  },

  clearIssue: (issueId) => {
    set((s) => {
      if (!(issueId in s.comments) && !s.loaded.has(issueId)) return s;
      const { [issueId]: _removed, ...rest } = s.comments;
      const nextLoaded = new Set(s.loaded);
      nextLoaded.delete(issueId);
      return { comments: rest, loaded: nextLoaded };
    });
  },
}));
