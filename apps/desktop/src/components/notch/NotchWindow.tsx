import { useEffect, useMemo, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  OpenedRow,
  CollapseChevronIcon,
  SystemIcon,
  AVATAR_PALETTE,
  hashToIndex,
  firstLetter,
  NotchTabBar,
} from './NotchPanelVisuals';
import {
  NOTCH_EVENT,
  type NotchStateSnapshot,
} from '../../services/notchBridge';
import { classifyToast, classifyFeedItem, type NotchTab } from '../../utils/notchTabCategory';
import { NOTCH_WINDOW_TIMINGS } from '../../config/notch';
import { EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB, type NotificationItem } from '@my-claudia/shared';
import type { Toast } from '../../stores/toastStore';
import type { PluginNotchTab } from '../../stores/pluginStore';

function NotchEmptyState({ activeTab, pluginNotchTabs }: { activeTab: NotchTab; pluginNotchTabs: PluginNotchTab[] }) {
  const pluginTab = activeTab.startsWith('plugin:')
    ? pluginNotchTabs.find((t) => `plugin:${t.id}` === activeTab)
    : undefined;
  const emptyTitle = activeTab === 'sessions' ? "You're all caught up."
    : activeTab === 'claudia' ? 'No Claudia activity.'
    : activeTab === 'approvals' ? 'No pending approvals.'
    : pluginTab ? `No ${pluginTab.label} activity.`
    : 'All systems normal.';
  const emptySubtitle = activeTab === 'sessions' ? 'Task results and session events will appear here.'
    : activeTab === 'claudia' ? 'Claudia Chat task results and updates will appear here.'
    : activeTab === 'approvals' ? 'Permission requests and AI reviews will appear here.'
    : pluginTab ? `${pluginTab.label} notifications will appear here.`
    : 'Connection and sync status will appear here.';
  return (
    <div className="px-6 py-10 text-center">
      <img src="/logo.png" alt="" className="w-10 h-10 mx-auto opacity-40 rounded-xl" draggable={false} />
      <p className="mt-3 text-[13px] text-white/60">{emptyTitle}</p>
      <p className="mt-1 text-[11px] text-white/40">{emptySubtitle}</p>
    </div>
  );
}

const AUTO_COLLAPSE_MS = NOTCH_WINDOW_TIMINGS.autoCollapseCheckMs;
const HOVER_EXPAND_DELAY = NOTCH_WINDOW_TIMINGS.hoverExpandDelayMs;
const OPEN_ANIM_DURATION_MS = NOTCH_WINDOW_TIMINGS.openAnimationDurationMs;
const CLOSE_ANIM_DURATION_MS = NOTCH_WINDOW_TIMINGS.closeAnimationDurationMs;

const SHAPE_CLOSED_W = 220;
const SHAPE_CLOSED_H = 32;
const SHAPE_OPENED_W = 460;
const SHAPE_OPENED_H = 440;
const TOP_R_CLOSED = 12;
const TOP_R_OPENED = 16;
const BOT_R_CLOSED = 20;
const BOT_R_OPENED = 26;

/** cubic-bezier(0.32, 0.72, 0, 1) approximation — fast start, gentle settle. */
function easeOut(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function buildIslandPath(w: number, h: number, topR: number, botR: number): string {
  const hw = w / 2;
  const ohw = hw + topR;
  return [
    `M ${-hw} ${topR}`,
    `Q ${-hw} 0 ${-ohw} 0`,
    `H ${ohw}`,
    `Q ${hw} 0 ${hw} ${topR}`,
    `V ${h - botR}`,
    `Q ${hw} ${h} ${hw - botR} ${h}`,
    `H ${-(hw - botR)}`,
    `Q ${-hw} ${h} ${-hw} ${h - botR}`,
    `V ${topR}`,
    'Z',
  ].join(' ');
}

/**
 * Standalone React entry for the independent `notch` Tauri window.
 *
 * Visual:
 *  - Closed: a small notch-shaped strip (flat top, rounded bottom) flush with
 *    the top edge of the screen — visually "extends" the physical notch.
 *  - Opened: a wider panel that drops down from the notch.
 *
 * State:
 *  - Mirrored from main window via `notch:state` Tauri events.
 *  - User actions are forwarded back to main via events.
 */
export function NotchWindow() {
  const [snapshot, setSnapshot] = useState<NotchStateSnapshot>({
    toasts: [],
    items: [],
    unreadCount: 0,
    unreadCountsByTab: { ...EMPTY_NOTIFICATION_UNREAD_COUNTS_BY_TAB },
    projects: [],
    lastPreviewTitle: null,
    hasPendingAttention: false,
    activeTab: 'sessions',
    pluginNotchTabs: [],
  });
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<NotchTab>('sessions');
  const autoCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSnapshotRef = useRef<NotchStateSnapshot | null>(null);
  const surfacePathRef = useRef<SVGPathElement | null>(null);

  // Mark the document so the shared CSS knows to make html/body/#root transparent
  // — otherwise the light-mode `--background` color paints the whole window white
  // and hides the notch shape.
  useEffect(() => {
    document.documentElement.classList.add('notch-window');
    document.body.classList.add('notch-window');
    return () => {
      document.documentElement.classList.remove('notch-window');
      document.body.classList.remove('notch-window');
    };
  }, []);

  // Listen for state snapshots from the main window.
  useEffect(() => {
    const un = listen<NotchStateSnapshot>(NOTCH_EVENT.state, (e) => {
      const next = e.payload;
      const prev = prevSnapshotRef.current;

      const prevToastIds = new Set((prev?.toasts ?? []).map((t) => t.id));
      const newToasts = next.toasts.filter((t) => !prevToastIds.has(t.id));
      const shouldAutoExpand = newToasts.some(
        (t) => t.icon === 'permission' || t.icon === 'task' || t.type === 'error',
      );

      prevSnapshotRef.current = next;
      setSnapshot(next);
      // Sync tab from main window
      if (next.activeTab) setActiveTab(next.activeTab);

      if (shouldAutoExpand) {
        // Auto-switch to the tab of the triggering toast
        const triggerToast = newToasts.find(
          (t) => t.icon === 'permission' || t.icon === 'task' || t.type === 'error',
        );
        if (triggerToast) {
          setActiveTab(triggerToast.category ?? classifyToast(triggerToast));
        }
        setIsOpen(true);
      }
    });
    return () => { un.then((u) => u()).catch(() => undefined); };
  }, []);

  useEffect(() => {
    const un = listen(NOTCH_EVENT.collapse, () => {
      setIsOpen(false);
    });
    return () => { un.then((u) => u()).catch(() => undefined); };
  }, []);

  useEffect(() => {
    const un = listen(NOTCH_EVENT.toggle, () => {
      setIsOpen((v) => !v);
    });
    return () => { un.then((u) => u()).catch(() => undefined); };
  }, []);

  // Escape key or window blur collapses the panel.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    const onBlur = () => {
      setIsOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [isOpen]);

  // --- Shape animation driven by requestAnimationFrame ---
  // `progress` goes 0 (closed) → 1 (open). All shape values are interpolated.
  const [progress, setProgress] = useState(0);
  const progressRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const hoverPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Enable click pass-through and start polling cursor position.
  // When cursor enters the pill area, disable pass-through so the webview
  // receives hover/click events and triggers expansion.
  const startPassthroughPolling = () => {
    invoke('set_notch_passthrough', { passthrough: true }).catch(() => undefined);
    if (hoverPollRef.current) clearInterval(hoverPollRef.current);
    hoverPollRef.current = setInterval(async () => {
      try {
        const inPill = await invoke<boolean>('check_notch_hover');
        if (inPill) {
          if (hoverPollRef.current) clearInterval(hoverPollRef.current);
          hoverPollRef.current = null;
          await invoke('set_notch_passthrough', { passthrough: false });
          // Cursor is already inside — mouseEnter won't fire, so expand directly.
          hoverExpandTimer.current = setTimeout(() => {
            setIsOpen(true);
          }, HOVER_EXPAND_DELAY);
        }
      } catch { /* ignore */ }
    }, 50);
  };

  // On mount: window is at full size, enable pass-through for collapsed state.
  useEffect(() => {
    startPassthroughPolling();
    return () => { if (hoverPollRef.current) clearInterval(hoverPollRef.current); };
  }, []);

  // Shape animation.
  useEffect(() => {
    const target = isOpen ? 1 : 0;
    const from = progressRef.current;
    if (from === target) return;

    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    if (isOpen) {
      // Expanding — stop polling, ensure pass-through is off.
      if (hoverPollRef.current) { clearInterval(hoverPollRef.current); hoverPollRef.current = null; }
      invoke('set_notch_passthrough', { passthrough: false }).catch(() => undefined);
      // Non-macOS: resize window.
      invoke('resize_notch_window', { expanded: true }).catch(() => undefined);
    }

    const startTime = performance.now();
    const baseDuration = target > from ? OPEN_ANIM_DURATION_MS : CLOSE_ANIM_DURATION_MS;
    const duration = baseDuration * Math.abs(target - from);

    const tick = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const v = from + (target - from) * easeOut(t);
      progressRef.current = v;
      setProgress(v);

      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        if (!isOpen) {
          // Collapse finished — enable pass-through and start polling.
          // Non-macOS: resize window.
          invoke('resize_notch_window', { expanded: false }).catch(() => undefined);
          startPassthroughPolling();
        }
      }
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [isOpen]);

  // Unified auto-collapse: while open, check every few seconds whether the
  // cursor is actually inside the visible panel area. If yes, defer the check;
  // otherwise collapse.
  useEffect(() => {
    if (!isOpen) {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
      autoCollapseTimer.current = null;
      return;
    }

    const scheduleCollapseCheck = () => {
      autoCollapseTimer.current = setTimeout(() => {
        invoke<boolean>('check_notch_panel_hover')
          .then((isPointerInsidePanel) => {
            if (isPointerInsidePanel) {
              scheduleCollapseCheck();
              return;
            }

            setIsOpen(false);
          })
          .catch(() => {
            setIsOpen(false);
          });
      }, AUTO_COLLAPSE_MS);
    };

    scheduleCollapseCheck();

    return () => {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
      autoCollapseTimer.current = null;
    };
  }, [isOpen]);

  // --- Hover to expand / collapse ---
  const clearHoverTimers = () => {
    if (hoverExpandTimer.current) {
      clearTimeout(hoverExpandTimer.current);
      hoverExpandTimer.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearHoverTimers();
    if (!isOpen) {
      hoverExpandTimer.current = setTimeout(() => {
        setIsOpen(true);
      }, HOVER_EXPAND_DELAY);
    }
  };

  const handleMouseLeave = () => {
    clearHoverTimers();
  };

  useEffect(() => () => clearHoverTimers(), []);

  // --- Derived state ---
  const pillPreview = useMemo(() => {
    if (snapshot.toasts.length > 0) {
      const t = snapshot.toasts[0];
      const projectName = t.projectId
        ? snapshot.projects.find((p) => p.id === t.projectId)?.name ?? null
        : null;
      return {
        title: t.title,
        icon: t.icon,
        type: t.type,
        projectId: t.projectId,
        projectName,
      };
    }
    if (snapshot.lastPreviewTitle) return { title: snapshot.lastPreviewTitle };
    return null;
  }, [snapshot]);

  const projectNameOf = (id?: string): string | null => {
    if (!id) return null;
    return snapshot.projects.find((p) => p.id === id)?.name ?? null;
  };

  // --- User actions (routed via events to main) ---
  const openSession = async (item: NotificationItem) => {
    setSnapshot((s) => ({
      ...s,
      items: s.items.map((i) => (i.id === item.id ? { ...i, readAt: Date.now() } : i)),
      unreadCount: Math.max(0, s.unreadCount - (item.readAt ? 0 : 1)),
    }));
    if (!item.readAt) {
      emit(NOTCH_EVENT.markRead, { ids: [item.id] }).catch(() => undefined);
    }
    setIsOpen(false);
    if (item.sessionId) {
      emit(NOTCH_EVENT.openSession, {
        sessionId: item.sessionId,
        backendId: item.ownerBackendId,
      }).catch(() => undefined);
    }
  };

  const dismissItem = (id: string) => {
    setSnapshot((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
    emit(NOTCH_EVENT.dismissItem, { id }).catch(() => undefined);
  };

  const markAllRead = () => {
    if (snapshot.unreadCount === 0) return;
    setSnapshot((s) => ({
      ...s,
      items: s.items.map((i) => (i.readAt ? i : { ...i, readAt: Date.now() })),
      unreadCount: 0,
    }));
    emit(NOTCH_EVENT.markAllRead).catch(() => undefined);
  };

  const clearRead = () => {
    const readIds = new Set(filteredItems.filter((i) => i.readAt).map((i) => i.id));
    if (readIds.size === 0) return;
    setSnapshot((s) => ({ ...s, items: s.items.filter((i) => !readIds.has(i.id)) }));
    for (const id of readIds) {
      emit(NOTCH_EVENT.dismissItem, { id }).catch(() => undefined);
    }
  };

  const toastClick = (t: Toast) => {
    setIsOpen(false);
    if (t.sessionId) {
      emit(NOTCH_EVENT.openSession, {
        sessionId: t.sessionId,
        backendId: t.serverId,
      }).catch(() => undefined);
    }
  };

  const handleTabChange = (tab: NotchTab) => {
    setActiveTab(tab);
    emit(NOTCH_EVENT.setTab, { tab }).catch(() => undefined);
  };

  // Filter by active tab
  const filteredToasts = useMemo(
    () => snapshot.toasts.filter((t) => (t.category ?? classifyToast(t)) === activeTab),
    [snapshot.toasts, activeTab],
  );
  const filteredItems = useMemo(
    () => snapshot.items.filter((i) => classifyFeedItem(i) === activeTab),
    [snapshot.items, activeTab],
  );

  // Per-tab unread counts — merge built-in with plugin tab counts
  const unreadCounts = useMemo(() => {
    const merged: Record<string, number> = { ...snapshot.unreadCountsByTab };
    for (const item of snapshot.items) {
      if (item.pluginTab && !item.readAt) {
        const key = `plugin:${item.pluginTab}`;
        merged[key] = (merged[key] ?? 0) + 1;
      }
    }
    return merged;
  }, [snapshot.unreadCountsByTab, snapshot.items]);

  // Sorted plugin notch tabs
  const pluginNotchTabs = useMemo(
    () => [...(snapshot.pluginNotchTabs ?? [])].sort((a, b) => a.order - b.order),
    [snapshot.pluginNotchTabs],
  );

  const hasReadItems = filteredItems.some((i) => i.readAt);

  // --- Closed notch content: small leading glyph + title preview + badge ---
  const closedLeading = pillPreview?.projectId && pillPreview.projectName ? (
    <div
      className={`w-4 h-4 rounded-full flex items-center justify-center text-white text-[9px] font-semibold ${
        AVATAR_PALETTE[hashToIndex(pillPreview.projectId, AVATAR_PALETTE.length)]
      }`}
      aria-hidden
    >
      {firstLetter(pillPreview.projectName)}
    </div>
  ) : pillPreview?.icon ? (
    <SystemIcon icon={pillPreview.icon} className="w-3 h-3 text-white/90" />
  ) : (
    <img src="/logo.png" alt="" className="w-4 h-4 rounded-full ring-1 ring-white/15 object-cover" draggable={false} />
  );

  const closedTrailing = snapshot.hasPendingAttention ? (
    <span className="relative w-1.5 h-1.5 flex-shrink-0">
      <span className="absolute inset-0 rounded-full bg-amber-400/70 animate-ping" />
      <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
    </span>
  ) : snapshot.unreadCount > 0 ? (
    <span className="min-w-[15px] h-3.5 px-1 flex items-center justify-center rounded-full bg-white/15 text-white text-[9.5px] font-semibold leading-none tabular-nums">
      {snapshot.unreadCount > 99 ? '99+' : snapshot.unreadCount}
    </span>
  ) : null;

  // --- Interpolated shape geometry (driven by `progress`) ---
  const p = progress;
  const shapeWidth = lerp(SHAPE_CLOSED_W, SHAPE_OPENED_W, p);
  const shapeHeight = lerp(SHAPE_CLOSED_H, SHAPE_OPENED_H, p);
  const topOuterRadius = lerp(TOP_R_CLOSED, TOP_R_OPENED, p);
  const bottomRadius = lerp(BOT_R_CLOSED, BOT_R_OPENED, p);
  const halfBodyWidth = shapeWidth / 2;
  const outerHalfWidth = halfBodyWidth + topOuterRadius;
  const canvasWidth = outerHalfWidth * 2;
  const islandPath = buildIslandPath(shapeWidth, shapeHeight, topOuterRadius, bottomRadius);

  // Content opacity driven by progress.
  // Opened content uses conditional rendering to avoid WebKit ghost artifacts
  // from invisible DOM elements in the large transparent window.
  const closedOpacity = p < 0.15 ? 1 : Math.max(0, 1 - (p - 0.15) / 0.15);
  const openedOpacity = p > 0.6 ? 1 : Math.max(0, (p - 0.4) / 0.2);

  // Click on transparent area (outside the panel shape) collapses the panel.
  const handleBackdropMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isOpen && e.target === e.currentTarget) {
      setIsOpen(false);
    }
  };

  return (
    <div className="w-full h-full relative" style={{ contain: 'strict' }} onMouseDown={handleBackdropMouseDown}>
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="absolute left-1/2 top-0"
        style={{
          width: canvasWidth,
          height: shapeHeight,
          transform: 'translateX(-50%)',
        }}
      >
        <svg
          aria-hidden
          className="absolute inset-0 z-0 text-black"
          viewBox={`${-outerHalfWidth} 0 ${canvasWidth} ${shapeHeight}`}
          preserveAspectRatio="none"
          style={{
            filter: p > 0.01
              ? (p > 0.5
                ? 'drop-shadow(0 6px 10px rgba(0,0,0,0.12))'
                : 'drop-shadow(0 4px 10px rgba(0,0,0,0.18))')
              : 'none',
          }}
        >
          <path ref={surfacePathRef} d={islandPath} fill="currentColor" />
        </svg>

        <div
          className="absolute top-0 left-1/2 z-10 overflow-hidden -translate-x-1/2"
          style={{ width: shapeWidth, height: shapeHeight }}
        >
        {/* Closed content — always rendered, opacity driven by progress */}
        <div
          className="absolute inset-x-0 top-0 flex h-8 translate-y-1 items-center justify-center gap-2 px-3"
          style={{
            opacity: closedOpacity,
            pointerEvents: closedOpacity > 0 ? 'auto' : 'none',
            visibility: closedOpacity > 0 ? 'visible' : 'hidden',
          }}
        >
          {closedLeading}
          <span className="text-[13px] font-semibold tracking-tight text-white truncate max-w-[150px]">
            {pillPreview?.title ?? 'MyClaudia'}
          </span>
          {closedTrailing}
        </div>

        {/* Opened content — conditionally rendered to avoid ghost artifacts */}
        {openedOpacity > 0 && (
        <div
          className="absolute inset-0 flex min-h-0 flex-col"
          style={{ opacity: openedOpacity }}
        >
            {/* Header */}
            <div className="relative flex min-h-11 items-start justify-end border-b border-white/[0.06] px-3 pt-3 pb-1.5 flex-shrink-0">
              <div className="absolute left-1/2 top-3 flex -translate-x-1/2 items-center gap-2">
                <img src="/logo.png" alt="" className="w-4 h-4 rounded-full ring-1 ring-white/15 object-cover" draggable={false} />
                <span className="text-[13px] font-semibold tracking-tight text-white">MyClaudia</span>
              </div>
              <div className="flex items-center gap-1 relative z-10">
                {hasReadItems && (
                  <button
                    onClick={clearRead}
                    className="px-2 h-6 text-[11px] text-white/55 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
                  >
                    Clear read
                  </button>
                )}
                {(unreadCounts[activeTab] ?? 0) > 0 && (
                  <button
                    onClick={markAllRead}
                    className="px-2 h-6 text-[11px] text-white/55 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            {/* Tab bar */}
            <NotchTabBar activeTab={activeTab} onTabChange={handleTabChange} unreadCounts={unreadCounts} pluginTabs={pluginNotchTabs} />

            {/* List */}
            <div className="flex-1 min-h-0 overflow-y-auto px-1.5 py-1.5">
              {filteredToasts.length > 0 && (
                <>
                  {filteredToasts.map((t) => (
                    <OpenedRow
                      key={t.id}
                      id={t.id}
                      title={t.title}
                      description={t.message}
                      createdAt={t.createdAt}
                      projectId={t.projectId}
                      projectName={projectNameOf(t.projectId)}
                      icon={t.icon}
                      type={t.type}
                      onClick={() => toastClick(t)}
                    />
                  ))}
                  {filteredItems.length > 0 && (
                    <div className="mx-3 my-1 border-t border-white/[0.04]" />
                  )}
                </>
              )}

              {filteredItems.length === 0 && filteredToasts.length === 0 ? (
                <NotchEmptyState activeTab={activeTab} pluginNotchTabs={pluginNotchTabs} />
              ) : (
                filteredItems.map((item) => (
                  <OpenedRow
                    key={item.id}
                    id={item.id}
                    title={item.title}
                    description={item.summary || item.error}
                    createdAt={item.createdAt}
                    projectId={item.projectId}
                    projectName={projectNameOf(item.projectId)}
                    status={item.status}
                    isUnread={!item.readAt}
                    onClick={() => openSession(item)}
                    onDismiss={() => dismissItem(item.id)}
                  />
                ))
              )}
            </div>

            <div className="flex items-center justify-center border-t border-white/[0.06] px-3 py-2.5 flex-shrink-0">
              <button
                type="button"
                onClick={() => { setIsOpen(false); }}
                aria-label="Collapse panel"
                className="group relative flex h-11 min-w-[44px] items-center justify-center rounded-full px-3 text-white/60 transition-colors hover:bg-white/[0.06] hover:text-white active:bg-white/[0.09]"
              >
                <CollapseChevronIcon className="h-5 w-5 transition-transform group-hover:-translate-y-0.5" />
              </button>
            </div>
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
