import { create } from 'zustand';
import type { AskUserQuestionItem } from '@my-claudia/shared';

export interface PromptRequest {
  requestId: string;
  /** The session this prompt belongs to (may be absent for older servers). */
  sessionId?: string;
  /** Source server ID (e.g. "gw:backend-1") — used to route the answer to the correct backend. */
  serverId?: string;
  /** Human-readable backend name for diagnostics and cross-backend routing UX. */
  backendName?: string;
  questions: AskUserQuestionItem[];
}

interface PromptRequestState {
  pendingRequests: PromptRequest[];
  pendingRequest: PromptRequest | null;
  setPendingRequest: (request: PromptRequest | null) => void;
  clearRequest: () => void;
  clearRequestById: (requestId: string) => void;
  clearAllRequests: () => void;
  clearRequestsForServer: (serverId: string) => void;
  clearRequestsForSession: (sessionId: string) => void;
  clearStaleRequests: (serverId: string, validIds: Set<string>) => void;
  hasRequest: (requestId: string) => boolean;
  getRequestsForSession: (sessionId: string) => PromptRequest[];
  getSessionsWithPendingRequests: () => string[];
}

export const usePromptRequestStore = create<PromptRequestState>((set, get) => ({
  pendingRequests: [],
  pendingRequest: null,

  setPendingRequest: (request) => {
    if (!request) {
      set({ pendingRequests: [], pendingRequest: null });
      return;
    }
    set((state) => {
      if (state.pendingRequests.some((r) => r.requestId === request.requestId)) {
        return state;
      }
      const updated = [...state.pendingRequests, request];
      return {
        pendingRequests: updated,
        pendingRequest: updated[0],
      };
    });
  },

  clearRequest: () =>
    set((state) => {
      const remaining = state.pendingRequests.slice(1);
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  clearAllRequests: () =>
    set({ pendingRequests: [], pendingRequest: null }),

  clearRequestById: (requestId) =>
    set((state) => {
      const remaining = state.pendingRequests.filter((r) => r.requestId !== requestId);
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  clearRequestsForServer: (serverId) =>
    set((state) => {
      const remaining = state.pendingRequests.filter((r) => r.serverId !== serverId);
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  clearRequestsForSession: (sessionId) =>
    set((state) => {
      const remaining = state.pendingRequests.filter((r) => r.sessionId !== sessionId);
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  clearStaleRequests: (serverId, validIds) =>
    set((state) => {
      const hasStale = state.pendingRequests.some(
        (r) => r.serverId === serverId && !validIds.has(r.requestId),
      );
      if (!hasStale) return state;
      const remaining = state.pendingRequests.filter(
        (r) => r.serverId !== serverId || validIds.has(r.requestId),
      );
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  hasRequest: (requestId): boolean => {
    return get().pendingRequests.some((r: PromptRequest) => r.requestId === requestId);
  },

  getRequestsForSession: (sessionId): PromptRequest[] => {
    return get().pendingRequests.filter((r) => r.sessionId === sessionId);
  },

  getSessionsWithPendingRequests: (): string[] => {
    return [...new Set(get().pendingRequests.map((r) => r.sessionId).filter(Boolean))] as string[];
  },
}));
