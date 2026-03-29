import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render } from '@testing-library/react';
import { NotificationItem } from '../NotificationItem';
import { useNotificationFeedStore } from '../../../stores/notificationFeedStore';

const sendMessage = vi.fn();
const selectSession = vi.fn();

vi.mock('../../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    sendMessage,
  }),
}));

vi.mock('../../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({
    selectSession,
  }),
}));

describe('NotificationItem', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationFeedStore.setState({
      items: [],
      unreadCount: 0,
      hasMore: false,
      loading: false,
      hydrated: false,
    });
  });

  it('marks unread notifications as read and selects the session on the owner backend', () => {
    const item = {
      id: 'notif-1',
      title: 'Gateway task finished',
      summary: 'Done',
      status: 'completed',
      source: 'scheduled',
      createdAt: Date.now(),
      sessionId: 'sess-2',
      ownerBackendId: 'backend-1',
    } as const;

    useNotificationFeedStore.setState({
      items: [item as any],
      unreadCount: 1,
    });

    const { getByRole } = render(<NotificationItem item={item as any} />);
    fireEvent.click(getByRole('button'));

    expect(sendMessage).toHaveBeenCalledWith({
      type: 'mark_notifications_read',
      itemIds: ['notif-1'],
    });
    expect(useNotificationFeedStore.getState().items[0]?.readAt).toBeTypeOf('number');
    expect(useNotificationFeedStore.getState().unreadCount).toBe(0);
    expect(selectSession).toHaveBeenCalledWith('sess-2', { backendId: 'backend-1' });
  });
});
