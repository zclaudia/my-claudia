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
  /** Clear client-synthesised Cursor plan reviews after the user responds manually */
  clearClientSynthPlanReviewsForSession: (sessionId: string) => void;
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
        // Different-session interactions: always keep
        if (interaction.sessionId !== sessionId) {
          filtered[id] = interaction;
          continue;
        }
        // Same-session: keep unresolved client-synthesised plan reviews so the
        // user can still act on them after the cursor run completes (cursor
        // does not block server-side on createPlan; the user's decision is
        // resolved client-side via handleSendMessage).
        if (
          interaction.type === 'interaction_plan_review' &&
          interaction.source === 'client_synth'
        ) {
          filtered[id] = interaction;
          continue;
        }
        // Other same-session interactions: drop (existing behaviour).
      }
      return { interactions: filtered };
    }),

  clearClientSynthPlanReviewsForSession: (sessionId) =>
    set((state) => {
      const filtered: Record<string, InteractionMessage> = {};
      for (const [id, interaction] of Object.entries(state.interactions)) {
        if (
          interaction.sessionId === sessionId
          && interaction.type === 'interaction_plan_review'
          && interaction.source === 'client_synth'
        ) {
          continue;
        }
        filtered[id] = interaction;
      }
      return { interactions: filtered };
    }),
}));
