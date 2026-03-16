import { create } from 'zustand';

interface BottomPanelState {
  activeTab: string;
  setActiveTab: (tab: string) => void;
}

export const useBottomPanelStore = create<BottomPanelState>((set) => ({
  activeTab: 'terminal',
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
