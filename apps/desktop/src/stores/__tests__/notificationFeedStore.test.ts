import { beforeEach, describe, expect, it } from 'vitest';
import { useNotificationFeedStore } from '../notificationFeedStore';
import { EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB } from '@my-claudia/shared';

describe('notificationFeedStore', () => {
  beforeEach(() => {
    useNotificationFeedStore.setState({
      items: [],
      unreadCount: 0,
      unreadCountsByTab: { ...EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB },
      hasMore: false,
      loading: false,
      hydrated: false,
    });
  });

  it('uses derived unread count when the full list is loaded', () => {
    useNotificationFeedStore.getState().setFeedList([
      { id: 'n1', title: 'one', status: 'completed', source: 'session', createdAt: 1 },
      { id: 'n2', title: 'two', status: 'completed', source: 'session', createdAt: 2, readAt: 3 },
      { id: 'n3', title: 'three', status: 'completed', source: 'session', createdAt: 4 },
    ] as any, false, 35, { sessions: 2, claudia: 9, approvals: 10, system: 14 }, false);

    const state = useNotificationFeedStore.getState();
    expect(state.unreadCount).toBe(2);
    expect(state.unreadCountsByTab).toEqual({ sessions: 2, claudia: 0, approvals: 0, system: 0 });
    expect(state.hasMore).toBe(false);
  });

  it('keeps server unread count when pagination indicates more items exist', () => {
    useNotificationFeedStore.getState().setFeedList([
      { id: 'n1', title: 'one', status: 'completed', source: 'session', createdAt: 1 },
      { id: 'n2', title: 'two', status: 'completed', source: 'session', createdAt: 2, readAt: 3 },
    ] as any, true, 35, { sessions: 1, claudia: 11, approvals: 9, system: 14 }, false);

    const state = useNotificationFeedStore.getState();
    expect(state.unreadCount).toBe(35);
    expect(state.unreadCountsByTab).toEqual({ sessions: 1, claudia: 11, approvals: 9, system: 14 });
    expect(state.hasMore).toBe(true);
  });

  it('markAllRead clears unread count and marks loaded items as read', () => {
    useNotificationFeedStore.setState({
      items: [
        { id: 'n1', title: 'one', status: 'completed', source: 'session', createdAt: 1 },
        { id: 'n2', title: 'two', status: 'completed', source: 'session', createdAt: 2, readAt: 3 },
        { id: 'n3', title: 'three', status: 'completed', source: 'session', createdAt: 4 },
      ] as any,
      unreadCount: 35,
      unreadCountsByTab: { sessions: 35, claudia: 0, approvals: 0, system: 0 },
      hasMore: true,
      loading: false,
      hydrated: true,
    });

    useNotificationFeedStore.getState().markAllRead(9);

    const state = useNotificationFeedStore.getState();
    expect(state.unreadCount).toBe(0);
    expect(state.unreadCountsByTab).toEqual({ sessions: 0, claudia: 0, approvals: 0, system: 0 });
    expect(state.items.every((item) => item.readAt === 3 || item.readAt === 9)).toBe(true);
  });
});
