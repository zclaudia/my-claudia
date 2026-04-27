import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const DEFAULT_WIDTH_PX = 380;
const MIN_WIDTH_PX = 240;
const MAX_WIDTH_VW = 50;

interface RightSidebarState {
  widthPx: number;
  /** Preferred active tab — may not match a currently-visible panel; consumers fallback. */
  activeTab: string | null;
  setActiveTab: (panelId: string) => void;
  setWidth: (px: number) => void;
}

export const useRightSidebarStore = create<RightSidebarState>()(
  persist(
    (set) => ({
      widthPx: DEFAULT_WIDTH_PX,
      activeTab: null,
      setActiveTab: (panelId) => set({ activeTab: panelId }),
      setWidth: (px) => {
        const maxPx = (typeof window !== 'undefined' ? window.innerWidth : 1920) * (MAX_WIDTH_VW / 100);
        set({ widthPx: Math.max(MIN_WIDTH_PX, Math.min(maxPx, px)) });
      },
    }),
    {
      name: 'claudia-right-sidebar',
      partialize: (state) => ({
        widthPx: state.widthPx,
        activeTab: state.activeTab,
      }),
    },
  ),
);

export const RIGHT_SIDEBAR_LIMITS = {
  MIN_WIDTH_PX,
  MAX_WIDTH_VW,
  DEFAULT_WIDTH_PX,
};
