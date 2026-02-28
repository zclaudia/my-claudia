import { create } from 'zustand';
import type { Supervision } from '@my-claudia/shared';

interface SupervisionState {
  // Keyed by sessionId for quick lookup
  supervisions: Record<string, Supervision>;
  // Pending planning hints: sessionId -> hint text (for auto-sending after dialog closes)
  pendingPlanningHints: Record<string, string>;

  setSupervision: (sessionId: string, supervision: Supervision | null) => void;
  updateSupervision: (supervision: Supervision) => void;
  removeSupervision: (sessionId: string) => void;
  setPendingHint: (sessionId: string, hint: string) => void;
  clearPendingHint: (sessionId: string) => void;
}

export const useSupervisionStore = create<SupervisionState>((set) => ({
  supervisions: {},
  pendingPlanningHints: {},

  setSupervision: (sessionId, supervision) =>
    set((state) => {
      if (!supervision) {
        const { [sessionId]: _, ...rest } = state.supervisions;
        return { supervisions: rest };
      }
      return { supervisions: { ...state.supervisions, [sessionId]: supervision } };
    }),

  updateSupervision: (supervision) =>
    set((state) => ({
      supervisions: {
        ...state.supervisions,
        [supervision.sessionId]: supervision,
      },
    })),

  removeSupervision: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.supervisions;
      return { supervisions: rest };
    }),

  setPendingHint: (sessionId, hint) =>
    set((state) => ({
      pendingPlanningHints: { ...state.pendingPlanningHints, [sessionId]: hint },
    })),

  clearPendingHint: (sessionId) =>
    set((state) => {
      const { [sessionId]: _, ...rest } = state.pendingPlanningHints;
      return { pendingPlanningHints: rest };
    }),
}));
