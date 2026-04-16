import { useEffect, useMemo, useRef, useState } from 'react';
import { emit, listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  OpenedRow,
  CloseIcon,
  SystemIcon,
  AVATAR_PALETTE,
  hashToIndex,
  firstLetter,
} from './NotchPanelVisuals';
import {
  NOTCH_EVENT,
  type NotchStateSnapshot,
} from '../services/notchBridge';
import type { NotificationItem } from '@my-claudia/shared';
import type { Toast } from '../stores/toastStore';

const AUTO_COLLAPSE_MS = 5000;
const HOVER_EXPAND_DELAY = 300;
const HOVER_COLLAPSE_DELAY = 200;

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
    projects: [],
    lastPreviewTitle: null,
    hasPendingAttention: false,
  });
  const [isOpen, setIsOpen] = useState(false);
  const [isAutoExpanded, setIsAutoExpanded] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const autoCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverExpandTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hoverCollapseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevSnapshotRef = useRef<NotchStateSnapshot | null>(null);
  const surfacePathRef = useRef<SVGPathElement | null>(null);
  const [closedVisualOffset, setClosedVisualOffset] = useState(0);

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

  useEffect(() => {
    const syncViewportWidth = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', syncViewportWidth);
    return () => window.removeEventListener('resize', syncViewportWidth);
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

      if (shouldAutoExpand) {
        setIsOpen(true);
        setIsAutoExpanded(true);
      }
    });
    return () => { un.then((u) => u()).catch(() => undefined); };
  }, []);

  useEffect(() => {
    const un = listen(NOTCH_EVENT.collapse, () => {
      setIsOpen(false);
      setIsAutoExpanded(false);
    });
    return () => { un.then((u) => u()).catch(() => undefined); };
  }, []);

  useEffect(() => {
    const un = listen(NOTCH_EVENT.toggle, () => {
      setIsOpen((v) => !v);
      setIsAutoExpanded(false);
    });
    return () => { un.then((u) => u()).catch(() => undefined); };
  }, []);

  // Keep the native notch window sized to the visible surface so transparent
  // regions do not intercept clicks when the panel is collapsed.
  useEffect(() => {
    invoke('resize_notch_window', { expanded: isOpen }).catch(() => undefined);
  }, [isOpen]);

  // Closed state should visually center the rendered black surface inside the
  // native window. Adjust the React layer itself instead of nudging the window.
  useEffect(() => {
    if (isOpen) {
      setClosedVisualOffset(0);
      return;
    }

    const node = surfacePathRef.current;
    if (!node) return;

    const raf = window.requestAnimationFrame(async () => {
      try {
        const rect = node.getBoundingClientRect();
        const surfaceCenterX = rect.left + rect.width / 2;
        const viewportCenterX = viewportWidth / 2;
        const delta = viewportCenterX - surfaceCenterX;
        if (Math.abs(delta) < 0.25) return;
        setClosedVisualOffset((prev) => prev + delta);
      } catch {
        // ignore centering measurement failures
      }
    });

    return () => window.cancelAnimationFrame(raf);
  }, [closedVisualOffset, isOpen, viewportWidth]);

  // Auto-collapse for toast-driven auto-open (skipped while hovered / manual).
  useEffect(() => {
    if (!isOpen || !isAutoExpanded || isHovering) {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
      autoCollapseTimer.current = null;
      return;
    }
    autoCollapseTimer.current = setTimeout(() => {
      setIsOpen(false);
      setIsAutoExpanded(false);
    }, AUTO_COLLAPSE_MS);
    return () => {
      if (autoCollapseTimer.current) clearTimeout(autoCollapseTimer.current);
      autoCollapseTimer.current = null;
    };
  }, [isOpen, isAutoExpanded, isHovering]);

  // --- Hover to expand / collapse ---
  const clearHoverTimers = () => {
    if (hoverExpandTimer.current) {
      clearTimeout(hoverExpandTimer.current);
      hoverExpandTimer.current = null;
    }
    if (hoverCollapseTimer.current) {
      clearTimeout(hoverCollapseTimer.current);
      hoverCollapseTimer.current = null;
    }
  };

  const handleMouseEnter = () => {
    setIsHovering(true);
    clearHoverTimers();
    if (!isOpen) {
      hoverExpandTimer.current = setTimeout(() => {
        setIsOpen(true);
        setIsAutoExpanded(true);  // Hover-opened panels auto-collapse on leave.
      }, HOVER_EXPAND_DELAY);
    }
  };

  const handleMouseLeave = () => {
    setIsHovering(false);
    clearHoverTimers();
    if (isOpen && isAutoExpanded) {
      hoverCollapseTimer.current = setTimeout(() => {
        setIsOpen(false);
        setIsAutoExpanded(false);
      }, HOVER_COLLAPSE_DELAY);
    }
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
    if (item.sessionId) {
      emit(NOTCH_EVENT.openSession, {
        sessionId: item.sessionId,
        backendId: item.ownerBackendId,
      }).catch(() => undefined);
      setIsOpen(false);
      setIsAutoExpanded(false);
    }
  };

  const dismissItem = (id: string) => {
    setSnapshot((s) => ({ ...s, items: s.items.filter((i) => i.id !== id) }));
    emit(NOTCH_EVENT.dismissItem, { id }).catch(() => undefined);
  };

  const markAllRead = () => {
    setSnapshot((s) => ({
      ...s,
      items: s.items.map((i) => (i.readAt ? i : { ...i, readAt: Date.now() })),
      unreadCount: 0,
    }));
    emit(NOTCH_EVENT.markAllRead, {}).catch(() => undefined);
  };

  const clearRead = () => {
    setSnapshot((s) => ({ ...s, items: s.items.filter((i) => !i.readAt) }));
    emit(NOTCH_EVENT.clearRead, {}).catch(() => undefined);
  };

  const toastClick = (t: Toast) => {
    setIsOpen(false);
    setIsAutoExpanded(false);
    if (t.sessionId) {
      emit(NOTCH_EVENT.openSession, {
        sessionId: t.sessionId,
        backendId: t.serverId,
      }).catch(() => undefined);
    }
  };

  const hasReadItems = snapshot.items.some((i) => i.readAt);

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

  // Explicit shape dimensions — the black notch is centered horizontally inside
  // the (possibly wider) Tauri window, keeping the shape symmetric regardless of
  // what size the OS actually gave the window.
  const SHAPE_CLOSED_W = 220;
  const SHAPE_CLOSED_H = 32;
  const SHAPE_OPENED_W = 460;
  const SHAPE_OPENED_H = 600;
  const shapeWidth = isOpen ? SHAPE_OPENED_W : SHAPE_CLOSED_W;
  const shapeHeight = isOpen ? SHAPE_OPENED_H : SHAPE_CLOSED_H;

  // Draw the visible shape around a true center line so closed/opened states
  // share the same geometric centering basis.
  const topOuterRadius = isOpen ? 16 : 12;
  const halfBodyWidth = shapeWidth / 2;
  const outerHalfWidth = halfBodyWidth + topOuterRadius;
  const canvasWidth = outerHalfWidth * 2;
  const bottomRadius = isOpen ? 26 : 20;
  const islandPath = [
    `M ${-halfBodyWidth} ${topOuterRadius}`,
    `Q ${-halfBodyWidth} 0 ${-outerHalfWidth} 0`,
    `H ${outerHalfWidth}`,
    `Q ${halfBodyWidth} 0 ${halfBodyWidth} ${topOuterRadius}`,
    `V ${shapeHeight - bottomRadius}`,
    `Q ${halfBodyWidth} ${shapeHeight} ${halfBodyWidth - bottomRadius} ${shapeHeight}`,
    `H ${-(halfBodyWidth - bottomRadius)}`,
    `Q ${-halfBodyWidth} ${shapeHeight} ${-halfBodyWidth} ${shapeHeight - bottomRadius}`,
    `V ${topOuterRadius}`,
    'Z',
  ].join(' ');

  return (
    // Root: fills the entire transparent Tauri window. The notch shape itself is
    // an absolutely-positioned box with explicit width — centered at the top —
    // so its geometry is independent of the underlying window size.
    <div className="w-full h-full relative">
      {/* Positioning wrapper holds the single notch-shaped surface. Hover
          handlers live here so the entire notch reacts. */}
      <div
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className="absolute left-1/2 top-0
                   transition-[width,height] duration-[320ms]
                   ease-[cubic-bezier(0.32,0.72,0,1)]"
        style={{
          width: canvasWidth,
          height: shapeHeight,
          transform: `translateX(calc(-50% + ${closedVisualOffset}px))`,
        }}
      >
        <svg
          aria-hidden
          className="absolute inset-0 z-0 text-black"
          viewBox={`${-outerHalfWidth} 0 ${canvasWidth} ${shapeHeight}`}
          preserveAspectRatio="none"
          style={{
            filter: isOpen
              ? 'drop-shadow(0 6px 10px rgba(0,0,0,0.12))'
              : 'drop-shadow(0 12px 28px rgba(0,0,0,0.42))',
          }}
        >
          <path ref={surfacePathRef} d={islandPath} fill="currentColor" />
        </svg>

        <div
          className="absolute top-0 left-1/2 z-10 overflow-hidden -translate-x-1/2"
          style={{ width: shapeWidth, height: shapeHeight }}
        >
        {/* Closed content — centered inside the ~32px notch strip */}
        {!isOpen && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 px-3">
            {closedLeading}
            <span className="text-[11px] font-medium tracking-tight text-white/90 truncate max-w-[150px]">
              {pillPreview?.title ?? 'MyClaudia'}
            </span>
            {closedTrailing}
          </div>
        )}

        {/* Opened content — header + list, fills the resized window */}
        {isOpen && (
          <div className="absolute inset-0 flex flex-col">
            {/* Header */}
            <div className="relative flex items-center justify-end px-3 pt-1.5 pb-1.5 border-b border-white/[0.06] flex-shrink-0">
              <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center gap-2">
                <img src="/logo.png" alt="" className="relative top-px w-4 h-4 rounded-full ring-1 ring-white/15 object-cover" draggable={false} />
                <span className="text-[13px] leading-none font-semibold tracking-tight text-white">Notifications</span>
                {snapshot.unreadCount > 0 && (
                  <span className="px-1.5 h-4 flex items-center justify-center text-[10px] font-semibold tabular-nums bg-white/15 text-white rounded-full">
                    {snapshot.unreadCount > 99 ? '99+' : snapshot.unreadCount}
                  </span>
                )}
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
                {snapshot.unreadCount > 0 && (
                  <button
                    onClick={markAllRead}
                    className="px-2 h-6 text-[11px] text-white/55 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
                  >
                    Mark all read
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => { setIsOpen(false); setIsAutoExpanded(false); }}
                  aria-label="Close"
                  className="w-6 h-6 flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors"
                >
                  <CloseIcon className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* List */}
            <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
              {snapshot.toasts.length > 0 && (
                <>
                  {snapshot.toasts.map((t) => (
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
                  {snapshot.items.length > 0 && (
                    <div className="mx-3 my-1 border-t border-white/[0.04]" />
                  )}
                </>
              )}

              {snapshot.items.length === 0 && snapshot.toasts.length === 0 ? (
                <div className="px-6 py-10 text-center">
                  <img src="/logo.png" alt="" className="w-10 h-10 mx-auto opacity-40 rounded-xl" draggable={false} />
                  <p className="mt-3 text-[13px] text-white/60">You're all caught up.</p>
                  <p className="mt-1 text-[11px] text-white/40">Task results and plugin events will appear here.</p>
                </div>
              ) : (
                snapshot.items.map((item) => (
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
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
