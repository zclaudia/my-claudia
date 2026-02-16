import { create } from 'zustand';

export interface PermissionRequest {
  requestId: string;
  toolName: string;
  detail: string;
  timeoutSec: number;
  /** When true, the UI should show a password input for credential (e.g. sudo). */
  requiresCredential?: boolean;
  /** Hint for what kind of credential is needed (e.g. 'sudo_password'). */
  credentialHint?: string;
}

interface PermissionState {
  // Queue of pending permission requests (FIFO)
  pendingRequests: PermissionRequest[];
  // First item in queue — for backward compatibility with PermissionModal
  pendingRequest: PermissionRequest | null;

  // Actions
  setPendingRequest: (request: PermissionRequest | null) => void;
  clearRequest: () => void;
  clearAllRequests: () => void;
}

export const usePermissionStore = create<PermissionState>((set) => ({
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

  // Clear everything (e.g. on run end)
  clearAllRequests: () =>
    set({ pendingRequests: [], pendingRequest: null }),
}));
