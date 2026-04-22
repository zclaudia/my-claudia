import { create } from 'zustand';
import type { NotificationItem } from '@my-claudia/shared';

function deriveUnreadCount(items: NotificationItem[]): number {
  return items.reduce((count, item) => count + (item.readAt ? 0 : 1), 0);
}

interface NotificationFeedState {
  items: NotificationItem[];
  unreadCount: number;
  hasMore: boolean;
  loading: boolean;
  hydrated: boolean;

  // Actions
  setFeedList: (items: NotificationItem[], hasMore: boolean, unreadCount: number, append?: boolean) => void;
  upsertItem: (item: NotificationItem) => void;
  markRead: (ids: string[], unreadCount?: number, readAt?: number) => void;
  markAllRead: (readAt?: number) => void;
  removeItem: (id: string) => void;
  clearRead: () => void;
  setLoading: (loading: boolean) => void;
}

export const useNotificationFeedStore = create<NotificationFeedState>((set) => ({
  items: [],
  unreadCount: 0,
  hasMore: false,
  loading: false,
  hydrated: false,

  setFeedList: (items, hasMore, unreadCount, append = false) => set((state) => {
    if (!append) {
      return {
        items,
        hasMore,
        unreadCount: hasMore ? Math.max(unreadCount, deriveUnreadCount(items)) : deriveUnreadCount(items),
        hydrated: true,
      };
    }

    const merged = [...state.items];
    const seen = new Set(state.items.map((item) => item.id));
    for (const item of items) {
      if (!seen.has(item.id)) {
        merged.push(item);
      }
    }

    return {
      items: merged,
      hasMore,
      unreadCount: hasMore ? Math.max(unreadCount, deriveUnreadCount(merged)) : deriveUnreadCount(merged),
      hydrated: true,
    };
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

  markAllRead: (readAt) => set((state) => {
    const now = readAt ?? Date.now();
    return {
      items: state.items.map((item) => (item.readAt ? item : { ...item, readAt: now })),
      unreadCount: 0,
    };
  }),

  removeItem: (id) => set((state) => {
    const item = state.items.find((i) => i.id === id);
    const unreadDelta = item && !item.readAt ? -1 : 0;
    return {
      items: state.items.filter((i) => i.id !== id),
      unreadCount: Math.max(0, state.unreadCount + unreadDelta),
    };
  }),

  clearRead: () => set((state) => ({
    items: state.items.filter((i) => !i.readAt),
  })),

  setLoading: (loading) => set({ loading }),
}));
