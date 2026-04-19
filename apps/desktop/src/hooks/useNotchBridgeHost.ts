import { useEffect, useRef } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { useToastStore } from '../stores/toastStore';
import { useNotificationFeedStore } from '../stores/notificationFeedStore';
import { useProjectStore } from '../stores/projectStore';
import { useNotchPanelStore } from '../stores/notchPanelStore';
import { useUIStore } from '../stores/uiStore';
import { useConnection } from '../contexts/ConnectionContext';
import { useSelectionCoordinator } from './useSelectionCoordinator';
import {
  NOTCH_EVENT,
  type NotchStateSnapshot,
  type NotchOpenSessionPayload,
  type NotchMarkReadPayload,
  type NotchDismissItemPayload,
  type NotchSetTabPayload,
} from '../services/notchBridge';

const SPAWN_DEBOUNCE_MS = 40;

/**
 * Host-side (main-window) bridge for the independent notch window.
 *
 * Responsibilities:
 *  1. Spawn the notch window on first mount (desktop only).
 *  2. Publish a `notch:state` snapshot whenever relevant stores change.
 *  3. Listen for notch-initiated actions and apply them to main stores
 *     and backend connection.
 */
export function useNotchBridgeHost(params: { enabled: boolean }): void {
  const { enabled } = params;
  const showNotchPanel = useUIStore((s) => s.showNotchPanel);
  const shouldEnable = enabled && showNotchPanel;
  const { sendMessage } = useConnection();
  const { selectSession } = useSelectionCoordinator();

  // Keep the latest callbacks without re-subscribing listeners.
  const handlersRef = useRef({ sendMessage, selectSession });
  handlersRef.current = { sendMessage, selectSession };

  // Spawn the notch window once.
  const spawnedRef = useRef(false);
  useEffect(() => {
    if (!shouldEnable || spawnedRef.current) return;
    spawnedRef.current = true;

    (async () => {
      try {
        const params = new URLSearchParams({ notchWindow: '1' });
        const notchUrl = `${window.location.origin}${window.location.pathname}?${params.toString()}`;
        await invoke('create_notch_window', { notchUrl });
        await invoke('resize_notch_window', { expanded: false });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn('[NotchBridge] create_notch_window failed:', err);
      }
    })();
  }, [shouldEnable]);

  // Publish state to the notch window whenever source stores change.
  useEffect(() => {
    if (!shouldEnable) return;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const publish = () => {
      const toasts = useToastStore.getState().toasts;
      const feed = useNotificationFeedStore.getState();
      const projects = useProjectStore.getState().projects.map((p) => ({ id: p.id, name: p.name }));
      const hasPendingAttention = toasts.some(
        (t) => t.icon === 'permission' || t.icon === 'error' || t.type === 'error',
      );
      const snapshot: NotchStateSnapshot = {
        toasts,
        items: feed.items,
        unreadCount: feed.unreadCount,
        projects,
        lastPreviewTitle: toasts[0]?.title ?? null,
        hasPendingAttention,
        activeTab: useNotchPanelStore.getState().activeTab,
      };
      emit(NOTCH_EVENT.state, snapshot).catch(() => undefined);
    };

    const schedulePublish = () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(publish, SPAWN_DEBOUNCE_MS);
    };

    // Kick off an initial publish so the notch window has data on boot.
    schedulePublish();

    const unsubs = [
      useToastStore.subscribe(schedulePublish),
      useNotificationFeedStore.subscribe(schedulePublish),
      useProjectStore.subscribe((s, prev) => {
        if (s.projects !== prev.projects) schedulePublish();
      }),
      useNotchPanelStore.subscribe((s, prev) => {
        if (s.activeTab !== prev.activeTab) schedulePublish();
      }),
    ];

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      unsubs.forEach((u) => u());
    };
  }, [shouldEnable]);

  // Listen for notch-initiated actions.
  useEffect(() => {
    if (!shouldEnable) return;
    const unlisteners: Array<Promise<() => void>> = [];

    unlisteners.push(
      listen<NotchOpenSessionPayload>(NOTCH_EVENT.openSession, async (e) => {
        const { sessionId, backendId } = e.payload;
        try {
          const win = getCurrentWindow();
          await win.show().catch(() => undefined);
          await win.unminimize().catch(() => undefined);
          await win.setFocus().catch(() => undefined);
        } catch { /* ignore */ }
        handlersRef.current.selectSession(sessionId, backendId ? { backendId } : undefined);
      }),
    );

    unlisteners.push(
      listen<NotchMarkReadPayload>(NOTCH_EVENT.markRead, (e) => {
        const { ids } = e.payload;
        if (ids.length === 0) return;
        handlersRef.current.sendMessage({ type: 'mark_notifications_read', itemIds: ids });
        useNotificationFeedStore.getState().markRead(ids);
      }),
    );

    unlisteners.push(
      listen<NotchDismissItemPayload>(NOTCH_EVENT.dismissItem, (e) => {
        const { id } = e.payload;
        handlersRef.current.sendMessage({ type: 'dismiss_notifications', itemIds: [id] });
        useNotificationFeedStore.getState().removeItem(id);
      }),
    );

    unlisteners.push(
      listen(NOTCH_EVENT.markAllRead, () => {
        const unreadIds = useNotificationFeedStore
          .getState()
          .items.filter((i) => !i.readAt)
          .map((i) => i.id);
        if (unreadIds.length === 0) return;
        handlersRef.current.sendMessage({ type: 'mark_notifications_read', itemIds: unreadIds });
        useNotificationFeedStore.getState().markRead(unreadIds);
      }),
    );

    unlisteners.push(
      listen(NOTCH_EVENT.clearRead, () => {
        handlersRef.current.sendMessage({ type: 'clear_read_notifications' });
        useNotificationFeedStore.getState().clearRead();
      }),
    );

    unlisteners.push(
      listen<NotchSetTabPayload>(NOTCH_EVENT.setTab, (e) => {
        useNotchPanelStore.getState().setActiveTab(e.payload.tab);
      }),
    );

    return () => {
      unlisteners.forEach((p) => p.then((u) => u()).catch(() => undefined));
    };
  }, [shouldEnable]);
}
