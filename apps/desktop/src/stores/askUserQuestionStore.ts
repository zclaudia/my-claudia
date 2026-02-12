import { create } from 'zustand';
import type { AskUserQuestionItem } from '@my-claudia/shared';

export interface AskUserQuestionRequest {
  requestId: string;
  questions: AskUserQuestionItem[];
}

interface AskUserQuestionState {
  pendingRequest: AskUserQuestionRequest | null;

  // Actions
  setPendingRequest: (request: AskUserQuestionRequest | null) => void;
  clearRequest: () => void;
}

export const useAskUserQuestionStore = create<AskUserQuestionState>((set) => ({
  pendingRequest: null,

  setPendingRequest: (request) => set({ pendingRequest: request }),

  clearRequest: () => set({ pendingRequest: null }),
}));
