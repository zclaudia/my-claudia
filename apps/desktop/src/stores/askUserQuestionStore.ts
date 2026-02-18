import { create } from 'zustand';
import type { AskUserQuestionItem } from '@my-claudia/shared';

export interface AskUserQuestionRequest {
  requestId: string;
  /** The session this question belongs to. */
  sessionId: string;
  /** Source server ID (e.g. "gw:backend-1") — used to route the answer to the correct backend. */
  serverId?: string;
  /** Human-readable backend name — shown in the modal when the request is from a non-active backend. */
  backendName?: string;
  questions: AskUserQuestionItem[];
}

interface AskUserQuestionState {
  // Queue of pending requests (FIFO)
  pendingRequests: AskUserQuestionRequest[];
  // First item in queue — for backward compatibility with AskUserQuestionModal
  pendingRequest: AskUserQuestionRequest | null;

  // Actions
  setPendingRequest: (request: AskUserQuestionRequest | null) => void;
  clearRequest: () => void;
  clearRequestById: (requestId: string) => void;
  clearAllRequests: () => void;
  clearRequestsForServer: (serverId: string) => void;
  clearStaleRequests: (serverId: string, validIds: Set<string>) => void;
  hasRequest: (requestId: string) => boolean;
  getRequestsForSession: (sessionId: string) => AskUserQuestionRequest[];
  getSessionsWithPendingRequests: () => string[];
}

export const useAskUserQuestionStore = create<AskUserQuestionState>((set, get) => ({
  pendingRequests: [],
  pendingRequest: null,

  setPendingRequest: (request) => {
    if (!request) {
      set({ pendingRequests: [], pendingRequest: null });
      return;
    }
    set((state) => {
      // Don't add duplicates
      if (state.pendingRequests.some(r => r.requestId === request.requestId)) {
        return state;
      }
      const updated = [...state.pendingRequests, request];
      return {
        pendingRequests: updated,
        pendingRequest: updated[0],
      };
    });
  },

  // Remove the first (current) request from queue, advance to next
  clearRequest: () =>
    set((state) => {
      const remaining = state.pendingRequests.slice(1);
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  // Clear everything (e.g. on run end)
  clearAllRequests: () =>
    set({ pendingRequests: [], pendingRequest: null }),

  // Remove a specific request by ID (e.g. resolved by another device)
  clearRequestById: (requestId) =>
    set((state) => {
      const remaining = state.pendingRequests.filter(r => r.requestId !== requestId);
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  // Clear all requests from a specific server (e.g. when that server's run ends)
  clearRequestsForServer: (serverId) =>
    set((state) => {
      const remaining = state.pendingRequests.filter(r => r.serverId !== serverId);
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  // Remove requests for a server that are not in the valid set (state heartbeat reconciliation)
  clearStaleRequests: (serverId, validIds) =>
    set((state) => {
      const remaining = state.pendingRequests.filter(
        r => r.serverId !== serverId || validIds.has(r.requestId)
      );
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  // Check if a request exists
  hasRequest: (requestId): boolean => {
    return get().pendingRequests.some((r: AskUserQuestionRequest) => r.requestId === requestId);
  },

  // Get all requests for a specific session
  getRequestsForSession: (sessionId): AskUserQuestionRequest[] => {
    return get().pendingRequests.filter(r => r.sessionId === sessionId);
  },

  // Get unique session IDs that have pending requests
  getSessionsWithPendingRequests: (): string[] => {
    return [...new Set(get().pendingRequests.map(r => r.sessionId))];
  },
}));
