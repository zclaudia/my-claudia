import { create } from 'zustand';
import type { AgentFeedItem } from '@my-claudia/shared';

interface AgentFeedState {
  items: AgentFeedItem[];
  unreadCount: number;
  hasMore: boolean;
  loading: boolean;

  // Actions
  setFeedList: (items: AgentFeedItem[], hasMore: boolean, unreadCount: number) => void;
  upsertItem: (item: AgentFeedItem) => void;
  markRead: (ids: string[]) => void;
  setLoading: (loading: boolean) => void;
}

export const useAgentFeedStore = create<AgentFeedState>((set) => ({
  items: [],
  unreadCount: 0,
  hasMore: false,
  loading: false,

  setFeedList: (items, hasMore, unreadCount) => set({ items, hasMore, unreadCount }),

  upsertItem: (item) => set((state) => {
    const idx = state.items.findIndex((i) => i.id === item.id);
    const newItems = [...state.items];
    if (idx >= 0) {
      newItems[idx] = item;
    } else {
      newItems.unshift(item); // newest first
    }
    // Recalculate unread
    const unreadCount = newItems.filter((i) => !i.readAt).length;
    return { items: newItems, unreadCount };
  }),

  markRead: (ids) => set((state) => {
    const now = Date.now();
    const idSet = new Set(ids);
    const newItems = state.items.map((item) =>
      idSet.has(item.id) && !item.readAt ? { ...item, readAt: now } : item
    );
    const unreadCount = newItems.filter((i) => !i.readAt).length;
    return { items: newItems, unreadCount };
  }),

  setLoading: (loading) => set({ loading }),
}));
