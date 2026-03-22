import { create } from 'zustand';

export interface Toast {
  id: string;
  title: string;
  message?: string;
  type: 'success' | 'error' | 'info';
  createdAt: number;
  /** Optional callback when toast is clicked */
  onClick?: () => void;
}

const MAX_TOASTS = 3;
const AUTO_DISMISS_MS = 5000;

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

    set((state) => ({
      toasts: [entry, ...state.toasts].slice(0, MAX_TOASTS),
    }));

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
