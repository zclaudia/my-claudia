import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Per-session "since" cursor for the Changes panel.
 *
 * Values:
 *   - `string`  — explicit user-message id chosen by the user
 *   - `null`    — "Entire session" explicitly chosen
 *   - missing   — never picked; consumer falls back to the latest user message
 *
 * Persisted so the user's pick survives panel close/reopen, session switch,
 * and full app restart.
 */
interface ChangesPanelState {
  pickedSinceBySession: Record<string, string | null>;
  setPickedSince: (sessionId: string, sinceMessageId: string | null) => void;
  clearPickedSince: (sessionId: string) => void;
}

export const useChangesPanelStore = create<ChangesPanelState>()(
  persist(
    (set) => ({
      pickedSinceBySession: {},
      setPickedSince: (sessionId, sinceMessageId) =>
        set((state) => {
          const current = state.pickedSinceBySession[sessionId];
          // No-op guard: skip the re-render + localStorage write when nothing
          // would change. Mirrors selectionStore's same-ref short-circuit.
          if (sessionId in state.pickedSinceBySession && current === sinceMessageId) {
            return state;
          }
          return {
            pickedSinceBySession: {
              ...state.pickedSinceBySession,
              [sessionId]: sinceMessageId,
            },
          };
        }),
      clearPickedSince: (sessionId) =>
        set((state) => {
          if (!(sessionId in state.pickedSinceBySession)) return state;
          const { [sessionId]: _removed, ...rest } = state.pickedSinceBySession;
          return { pickedSinceBySession: rest };
        }),
    }),
    {
      name: 'claudia-changes-panel',
      partialize: (state) => ({
        pickedSinceBySession: state.pickedSinceBySession,
      }),
    },
  ),
);
