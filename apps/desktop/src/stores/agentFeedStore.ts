import { create } from 'zustand';
import type { AgentFeedItem } from '@my-claudia/shared';

interface AgentFeedState {
  items: AgentFeedItem[];
  unreadCount: number;
  hasMore: boolean;
  loading: boolean;
  hydrated: boolean;

  // Actions
  setFeedList: (items: AgentFeedItem[], hasMore: boolean, unreadCount: number, append?: boolean) => void;
  upsertItem: (item: AgentFeedItem) => void;
  markRead: (ids: string[], unreadCount?: number, readAt?: number) => void;
  setLoading: (loading: boolean) => void;
}

export const useAgentFeedStore = create<AgentFeedState>((set) => ({
  items: [],
  unreadCount: 0,
  hasMore: false,
  loading: false,
  hydrated: false,

  setFeedList: (items, hasMore, unreadCount, append = false) => set((state) => {
    if (!append) {
      return { items, hasMore, unreadCount, hydrated: true };
    }

    const merged = [...state.items];
    const seen = new Set(state.items.map((item) => item.id));
    for (const item of items) {
      if (!seen.has(item.id)) {
        merged.push(item);
      }
    }

    return { items: merged, hasMore, unreadCount, hydrated: true };
  }),

  upsertItem: (item) => set((state) => {
    const idx = state.items.findIndex((i) => i.id === item.id);
    const newItems = [...state.items];
    let unreadCount = state.unreadCount;
    if (idx >= 0) {
      const previous = newItems[idx];
      newItems[idx] = item;
      if (!previous.readAt && item.readAt) {
        unreadCount = Math.max(0, unreadCount - 1);
      } else if (previous.readAt && !item.readAt) {
        unreadCount += 1;
      }
    } else {
      newItems.unshift(item); // newest first
      if (!item.readAt) unreadCount += 1;
    }
    return { items: newItems, unreadCount };
  }),

  markRead: (ids, unreadCount, readAt) => set((state) => {
    const now = readAt ?? Date.now();
    const idSet = new Set(ids);
    let markedKnownUnread = 0;
    const newItems = state.items.map((item) => {
      if (!idSet.has(item.id) || item.readAt) {
        return item;
      }
      markedKnownUnread += 1;
      return { ...item, readAt: now };
    });
    const nextUnreadCount = unreadCount ?? Math.max(0, state.unreadCount - markedKnownUnread);
    return { items: newItems, unreadCount: nextUnreadCount };
  }),

  setLoading: (loading) => set({ loading }),
}));
