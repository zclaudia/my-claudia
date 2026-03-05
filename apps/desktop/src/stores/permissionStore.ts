import { create } from 'zustand';

export interface PermissionRequest {
  requestId: string;
  /** The session this permission request belongs to (may be absent for older servers). */
  sessionId?: string;
  /** Source server ID (e.g. "gw:backend-1") — used to route the response to the correct backend. */
  serverId?: string;
  /** Human-readable backend name — shown in the modal when the request is from a non-active backend. */
  backendName?: string;
  toolName: string;
  detail: string;
  timeoutSec: number;
  /** When true, the UI should show a password input for credential (e.g. sudo). */
  requiresCredential?: boolean;
  /** Hint for what kind of credential is needed (e.g. 'sudo_password'). */
  credentialHint?: string;
  /** When true, timeout will auto-approve; countdown label changes accordingly. */
  aiInitiated?: boolean;
}

interface PermissionState {
  // Queue of pending permission requests (FIFO)
  pendingRequests: PermissionRequest[];
  // First item in queue — for backward compatibility with PermissionModal
  pendingRequest: PermissionRequest | null;

  // Actions
  setPendingRequest: (request: PermissionRequest | null) => void;
  clearRequest: () => void;
  clearRequestById: (requestId: string) => void;
  clearAllRequests: () => void;
  clearStaleRequests: (serverId: string, validIds: Set<string>) => void;
  hasRequest: (requestId: string) => boolean;
  getRequestsForSession: (sessionId: string) => PermissionRequest[];
  getSessionsWithPendingRequests: () => string[];
}

export const usePermissionStore = create<PermissionState>((set, get) => ({
  pendingRequests: [],
  pendingRequest: null,

  setPendingRequest: (request) => {
    if (!request) {
      // null clears the queue (backward compat)
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

  // Remove a specific request by ID (e.g. resolved by another device)
  clearRequestById: (requestId) =>
    set((state) => {
      const remaining = state.pendingRequests.filter(r => r.requestId !== requestId);
      return {
        pendingRequests: remaining,
        pendingRequest: remaining[0] || null,
      };
    }),

  // Clear everything (e.g. on run end)
  clearAllRequests: () =>
    set({ pendingRequests: [], pendingRequest: null }),

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
    return get().pendingRequests.some((r: PermissionRequest) => r.requestId === requestId);
  },

  // Get all requests for a specific session
  getRequestsForSession: (sessionId): PermissionRequest[] => {
    return get().pendingRequests.filter(r => r.sessionId === sessionId);
  },

  // Get unique session IDs that have pending requests
  getSessionsWithPendingRequests: (): string[] => {
    return [...new Set(get().pendingRequests.map(r => r.sessionId).filter((id): id is string => !!id))];
  },
}));
