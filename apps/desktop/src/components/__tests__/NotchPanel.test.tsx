// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NotchPanel } from '../NotchPanel';
import { useNotchPanelStore } from '../../stores/notchPanelStore';
import { useToastStore } from '../../stores/toastStore';
import { useNotificationFeedStore } from '../../stores/notificationFeedStore';
import { useProjectStore } from '../../stores/projectStore';

vi.mock('../../contexts/ConnectionContext', () => ({
  useConnection: () => ({
    sendMessage: vi.fn(),
  }),
}));

vi.mock('../../hooks/useSelectionCoordinator', () => ({
  useSelectionCoordinator: () => ({
    selectSession: vi.fn(),
  }),
}));

describe('NotchPanel', () => {
  beforeEach(() => {
    cleanup();
    useNotchPanelStore.setState({
      isOpen: false,
      isHovering: false,
      isAutoExpanded: false,
      lastPreviewTitle: null,
      activeTab: 'sessions',
      lastActivityTab: 'sessions',
    });
    useToastStore.setState({ toasts: [] });
    useNotificationFeedStore.setState({
      items: [],
      unreadCount: 0,
      hasMore: false,
      loading: false,
      hydrated: true,
    });
    useProjectStore.setState({ projects: [], sessions: [] } as any);
  });

  it('renders bottom collapse control instead of header close button', () => {
    useNotchPanelStore.getState().open();

    render(<NotchPanel />);

    expect(screen.queryByLabelText('Close')).toBeNull();
    expect(screen.getByLabelText('Collapse panel')).toBeTruthy();
  });

  it('collapses when bottom collapse control is clicked', () => {
    useNotchPanelStore.getState().open();

    render(<NotchPanel />);

    fireEvent.click(screen.getByLabelText('Collapse panel'));

    expect(useNotchPanelStore.getState().isOpen).toBe(false);
    expect(screen.getByTestId('notch-pill')).toBeTruthy();
  });

  it('collapses when a notification row is clicked even without a session target', () => {
    useNotchPanelStore.getState().open();
    useNotificationFeedStore.setState({
      items: [
        {
          id: 'notif-1',
          title: 'Run completed: Codex',
          summary: 'Session response is ready.',
          status: 'completed',
          source: 'manual',
          createdAt: Date.now(),
        } as any,
      ],
      unreadCount: 1,
      hasMore: false,
      loading: false,
      hydrated: true,
    });

    render(<NotchPanel />);

    fireEvent.click(screen.getByText('Run completed: Codex'));

    expect(useNotchPanelStore.getState().isOpen).toBe(false);
  });
});
