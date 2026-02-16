import { create } from 'zustand';
import type { Supervision } from '@my-claudia/shared';

interface SupervisionState {
  // Keyed by sessionId for quick lookup
  supervisions: Record<string, Supervision>;

  setSupervision: (sessionId: string, supervision: Supervision | null) => void;
  updateSupervision: (supervision: Supervision) => void;
  removeSupervision: (sessionId: string) => void;
}

export const useSupervisionStore = create<SupervisionState>((set) => ({
  supervisions: {},

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
}));
