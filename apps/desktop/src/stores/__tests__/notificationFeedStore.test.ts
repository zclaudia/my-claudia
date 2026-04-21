import { beforeEach, describe, expect, it } from 'vitest';
import { useNotificationFeedStore } from '../notificationFeedStore';

describe('notificationFeedStore', () => {
  beforeEach(() => {
    useNotificationFeedStore.setState({
      items: [],
      unreadCount: 0,
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
    ] as any, false, 35, false);

    const state = useNotificationFeedStore.getState();
    expect(state.unreadCount).toBe(2);
    expect(state.hasMore).toBe(false);
  });

  it('keeps server unread count when pagination indicates more items exist', () => {
    useNotificationFeedStore.getState().setFeedList([
      { id: 'n1', title: 'one', status: 'completed', source: 'session', createdAt: 1 },
      { id: 'n2', title: 'two', status: 'completed', source: 'session', createdAt: 2, readAt: 3 },
    ] as any, true, 35, false);

    const state = useNotificationFeedStore.getState();
    expect(state.unreadCount).toBe(35);
    expect(state.hasMore).toBe(true);
  });
});
