import { create } from 'zustand';

/**
 * Always-resident NotchPanel (Dynamic Island-style) state.
 *
 * Closed state is rendered as a small top-center pill. Opened state expands
 * downward into a full notification panel. Auto-expand is triggered by the
 * message handler on high-value events; hover pauses the auto-collapse timer.
 */

interface NotchPanelState {
  isOpen: boolean;
  /** `true` while the user hovers the open panel — pauses auto-collapse. */
  isHovering: boolean;
  /** `true` when open was triggered by an auto-expand; user click clears this. */
  isAutoExpanded: boolean;
  /** Last title shown in the closed pill (for a compact preview). */
  lastPreviewTitle: string | null;

  open: (opts?: { auto?: boolean; previewTitle?: string }) => void;
  close: () => void;
  toggle: () => void;
  setHovering: (hovering: boolean) => void;
  setPreviewTitle: (title: string | null) => void;
}

const AUTO_COLLAPSE_MS = 5000;

let autoCollapseTimer: ReturnType<typeof setTimeout> | null = null;

function clearAutoCollapse() {
  if (autoCollapseTimer) {
    clearTimeout(autoCollapseTimer);
    autoCollapseTimer = null;
  }
}

export const useNotchPanelStore = create<NotchPanelState>((set, get) => ({
  isOpen: false,
  isHovering: false,
  isAutoExpanded: false,
  lastPreviewTitle: null,

  open: (opts) => {
    clearAutoCollapse();
    const auto = !!opts?.auto;
    set({
      isOpen: true,
      isAutoExpanded: auto,
      ...(opts?.previewTitle ? { lastPreviewTitle: opts.previewTitle } : {}),
    });

    if (auto) {
      autoCollapseTimer = setTimeout(() => {
        const s = get();
        // If the user interacted (manual open) or is hovering, skip auto-collapse.
        if (!s.isAutoExpanded || s.isHovering) return;
        set({ isOpen: false, isAutoExpanded: false });
      }, AUTO_COLLAPSE_MS);
    }
  },

  close: () => {
    clearAutoCollapse();
    set({ isOpen: false, isAutoExpanded: false });
  },

  toggle: () => {
    const { isOpen } = get();
    if (isOpen) {
      get().close();
    } else {
      get().open({ auto: false });
    }
  },

  setHovering: (hovering) => {
    set({ isHovering: hovering });
    // Hovering out while auto-expanded restarts the auto-collapse timer.
    if (!hovering && get().isAutoExpanded && get().isOpen) {
      clearAutoCollapse();
      autoCollapseTimer = setTimeout(() => {
        const s = get();
        if (!s.isAutoExpanded || s.isHovering) return;
        set({ isOpen: false, isAutoExpanded: false });
      }, AUTO_COLLAPSE_MS);
    } else if (hovering) {
      clearAutoCollapse();
    }
  },

  setPreviewTitle: (title) => set({ lastPreviewTitle: title }),
}));

// Dev-only: expose for manual testing.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__notchStore = useNotchPanelStore;
}
