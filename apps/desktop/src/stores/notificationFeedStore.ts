import { create } from 'zustand';
import {
  EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB,
  classifyNotificationItemTab,
  type NotificationItem,
  type NotificationUnreadCountsByTab,
} from '@my-claudia/shared';

function deriveUnreadCount(items: NotificationItem[]): number {
  return items.reduce((count, item) => count + (item.readAt ? 0 : 1), 0);
}

function deriveUnreadCountsByTab(items: NotificationItem[]): NotificationUnreadCountsByTab {
  const counts: NotificationUnreadCountsByTab = { ...EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB };
  for (const item of items) {
    if (item.readAt) continue;
    counts[classifyNotificationItemTab(item)] += 1;
  }
  return counts;
}

interface NotificationFeedState {
  items: NotificationItem[];
  unreadCount: number;
  unreadCountsByTab: NotificationUnreadCountsByTab;
  hasMore: boolean;
  loading: boolean;
  hydrated: boolean;

  // Actions
  setFeedList: (
    items: NotificationItem[],
    hasMore: boolean,
    unreadCount: number,
    unreadCountsByTab: NotificationUnreadCountsByTab,
    append?: boolean,
  ) => void;
  upsertItem: (item: NotificationItem) => void;
  markRead: (ids: string[], unreadCount?: number, unreadCountsByTab?: NotificationUnreadCountsByTab, readAt?: number) => void;
  markAllRead: (readAt?: number) => void;
  removeItem: (id: string) => void;
  clearRead: () => void;
  setLoading: (loading: boolean) => void;
}

export const useNotificationFeedStore = create<NotificationFeedState>((set) => ({
  items: [],
  unreadCount: 0,
  unreadCountsByTab: { ...EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB },
  hasMore: false,
  loading: false,
  hydrated: false,

  setFeedList: (items, hasMore, unreadCount, unreadCountsByTab, append = false) => set((state) => {
    const mergeUnreadCounts = (mergedItems: NotificationItem[]) => (
      hasMore
        ? { ...unreadCountsByTab }
        : deriveUnreadCountsByTab(mergedItems)
    );

    if (!append) {
      return {
        items,
        hasMore,
        unreadCount: hasMore ? Math.max(unreadCount, deriveUnreadCount(items)) : deriveUnreadCount(items),
        unreadCountsByTab: mergeUnreadCounts(items),
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
      unreadCountsByTab: mergeUnreadCounts(merged),
      hydrated: true,
    };
  }),

  upsertItem: (item) => set((state) => {
    const idx = state.items.findIndex((i) => i.id === item.id);
    const newItems = [...state.items];
    let unreadCount = state.unreadCount;
    const unreadCountsByTab = { ...state.unreadCountsByTab };
    const itemTab = classifyNotificationItemTab(item);
    if (idx >= 0) {
      const previous = newItems[idx];
      newItems[idx] = item;
      if (!previous.readAt && item.readAt) {
        unreadCount = Math.max(0, unreadCount - 1);
        unreadCountsByTab[classifyNotificationItemTab(previous)] = Math.max(
          0,
          unreadCountsByTab[classifyNotificationItemTab(previous)] - 1,
        );
      } else if (previous.readAt && !item.readAt) {
        unreadCount += 1;
        unreadCountsByTab[itemTab] += 1;
      } else if (!previous.readAt && !item.readAt) {
        const previousTab = classifyNotificationItemTab(previous);
        if (previousTab !== itemTab) {
          unreadCountsByTab[previousTab] = Math.max(0, unreadCountsByTab[previousTab] - 1);
          unreadCountsByTab[itemTab] += 1;
        }
      }
    } else {
      newItems.unshift(item); // newest first
      if (!item.readAt) {
        unreadCount += 1;
        unreadCountsByTab[itemTab] += 1;
      }
    }
    return { items: newItems, unreadCount, unreadCountsByTab };
  }),

  markRead: (ids, unreadCount, unreadCountsByTab, readAt) => set((state) => {
    const now = readAt ?? Date.now();
    const idSet = new Set(ids);
    const nextUnreadCountsByTab = unreadCountsByTab ? { ...unreadCountsByTab } : { ...state.unreadCountsByTab };
    let markedKnownUnread = 0;
    const newItems = state.items.map((item) => {
      if (!idSet.has(item.id) || item.readAt) {
        return item;
      }
      markedKnownUnread += 1;
      if (!unreadCountsByTab) {
        const tab = classifyNotificationItemTab(item);
        nextUnreadCountsByTab[tab] = Math.max(0, nextUnreadCountsByTab[tab] - 1);
      }
      return { ...item, readAt: now };
    });
    const nextUnreadCount = unreadCount ?? Math.max(0, state.unreadCount - markedKnownUnread);
    return { items: newItems, unreadCount: nextUnreadCount, unreadCountsByTab: nextUnreadCountsByTab };
  }),

  markAllRead: (readAt) => set((state) => {
    const now = readAt ?? Date.now();
    return {
      items: state.items.map((item) => (item.readAt ? item : { ...item, readAt: now })),
      unreadCount: 0,
      unreadCountsByTab: { ...EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB },
    };
  }),

  removeItem: (id) => set((state) => {
    const item = state.items.find((i) => i.id === id);
    const unreadDelta = item && !item.readAt ? -1 : 0;
    const unreadCountsByTab = { ...state.unreadCountsByTab };
    if (item && !item.readAt) {
      const tab = classifyNotificationItemTab(item);
      unreadCountsByTab[tab] = Math.max(0, unreadCountsByTab[tab] - 1);
    }
    return {
      items: state.items.filter((i) => i.id !== id),
      unreadCount: Math.max(0, state.unreadCount + unreadDelta),
      unreadCountsByTab,
    };
  }),

  clearRead: () => set((state) => ({
    items: state.items.filter((i) => !i.readAt),
  })),

  setLoading: (loading) => set({ loading }),
}));
