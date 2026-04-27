import { create } from 'zustand';
import { useNotchPanelStore } from './notchPanelStore';
import { classifyToast, type NotchTab } from '../utils/notchTabCategory';

export type ToastIcon = 'system' | 'permission' | 'task' | 'error';

export interface Toast {
  id: string;
  title: string;
  message?: string;
  type: 'success' | 'error' | 'info';
  createdAt: number;
  /** Optional callback when toast is clicked */
  onClick?: () => void;
  /** Project this toast relates to — used by NotchPanel to render project avatar/name. */
  projectId?: string;
  /** Session this toast relates to — used for click-to-navigate. */
  sessionId?: string;
  /** Owning backend — for cross-gateway project lookup. */
  serverId?: string;
  /** Icon category when there is no project context. */
  icon?: ToastIcon;
  /** Who initiated this toast — used to route to the Claudia tab. */
  initiator?: 'system' | 'claudia';
  /** Auto-computed tab category for notch panel filtering. */
  category?: NotchTab;
  /** Target plugin notch tab (namespaced 'pluginId/tabId') — routes toast to plugin tab. */
  pluginTab?: string;
}

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 3000;

interface ToastState {
  toasts: Toast[];
  add: (toast: Omit<Toast, 'id' | 'createdAt'>) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],

  add: (toast) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const entry: Toast = { ...toast, id, createdAt: Date.now() };
    entry.category = classifyToast(entry);

    set((state) => {
      const base = toast.sessionId
        ? state.toasts.filter((t) => t.sessionId !== toast.sessionId)
        : state.toasts;
      return { toasts: [entry, ...base].slice(0, MAX_TOASTS) };
    });

    // Mirror title into the NotchPanel closed-pill preview so users see the
    // latest event even if they don't have the panel open.
    const notchStore = useNotchPanelStore.getState();
    notchStore.setPreviewTitle(entry.title);
    notchStore.setLastActivityTab(entry.category);

    // Auto-dismiss
    setTimeout(() => {
      set((state) => ({
        toasts: state.toasts.filter((t) => t.id !== id),
      }));
    }, AUTO_DISMISS_MS);
  },

  remove: (id) => set((state) => ({
    toasts: state.toasts.filter((t) => t.id !== id),
  })),
}));

// Dev-only: expose store on window for manual testing (e.g. NotchPanel demo)
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as any).__toastStore = useToastStore;
}
