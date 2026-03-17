import { create } from 'zustand';
import type { ProcessCleanupResultMessage } from '@my-claudia/shared';

interface ProcessMonitorState {
  lastCleanupResult: ProcessCleanupResultMessage | null;
  setCleanupResult: (result: ProcessCleanupResultMessage) => void;
  clearCleanupResult: () => void;
}

export const useProcessMonitorStore = create<ProcessMonitorState>((set) => ({
  lastCleanupResult: null,

  setCleanupResult: (result) => set({ lastCleanupResult: result }),

  clearCleanupResult: () => set({ lastCleanupResult: null }),
}));
