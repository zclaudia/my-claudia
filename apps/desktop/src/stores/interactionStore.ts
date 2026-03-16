import { create } from 'zustand';
import type { InteractionMessage } from '@my-claudia/shared';

interface InteractionState {
  /** All active interactions keyed by interactionId */
  interactions: Record<string, InteractionMessage>;

  /** Upsert an interaction (TodoUpdate with same ID overwrites previous) */
  upsertInteraction: (event: InteractionMessage) => void;
  /** Mark an interaction as resolved (remove it) */
  resolveInteraction: (interactionId: string) => void;
  /** Check if an interaction exists */
  has: (interactionId: string) => boolean;
  /** Get all interactions for a session */
  getBySession: (sessionId: string) => InteractionMessage[];
  /** Clear all interactions for a session */
  clearSession: (sessionId: string) => void;
}

export const useInteractionStore = create<InteractionState>((set, get) => ({
  interactions: {},

  upsertInteraction: (event) =>
    set((state) => ({
      interactions: { ...state.interactions, [event.interactionId]: event },
    })),

  resolveInteraction: (interactionId) =>
    set((state) => {
      const { [interactionId]: _, ...rest } = state.interactions;
      return { interactions: rest };
    }),

  has: (interactionId) => interactionId in get().interactions,

  getBySession: (sessionId) =>
    Object.values(get().interactions).filter((i) => i.sessionId === sessionId),

  clearSession: (sessionId) =>
    set((state) => {
      const filtered: Record<string, InteractionMessage> = {};
      for (const [id, interaction] of Object.entries(state.interactions)) {
        if (interaction.sessionId !== sessionId) {
          filtered[id] = interaction;
        }
      }
      return { interactions: filtered };
    }),
}));
