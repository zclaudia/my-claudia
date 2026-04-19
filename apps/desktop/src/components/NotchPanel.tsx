import { useEffect, useRef, useMemo, useCallback } from 'react';
import { useToastStore, type Toast, type ToastIcon } from '../stores/toastStore';
import { useProjectStore } from '../stores/projectStore';
import { useNotificationFeedStore } from '../stores/notificationFeedStore';
import { useNotchPanelStore } from '../stores/notchPanelStore';
import { useConnection } from '../contexts/ConnectionContext';
import { useSelectionCoordinator } from '../hooks/useSelectionCoordinator';
import { timeAgo } from '../utils/timeAgo';
import { classifyToast, classifyFeedItem, type NotchTab } from '../utils/notchTabCategory';
import { NotchTabBar } from './NotchPanelVisuals';
import type { NotificationItem as NotificationItemData } from '@my-claudia/shared';

// ---------------------------------------------------------------------------
// Apple-style Dynamic Island notification surface.
//
// Visual system:
//  - Glass: bg-black/65 + backdrop-blur-2xl + saturate-150 (approximates
//    macOS `hudWindow` / iOS material).
//  - Rim highlight: inset 0 1px 0 rgba(255,255,255,0.12) on the top edge.
//  - Soft outer shadow: 0 10px 30px -8px rgba(0,0,0,0.55).
//  - Typography: tracking-tight + font-medium (SF Pro Text is the system
//    default on macOS / iOS inside Tauri's webview).
//  - Easing: cubic-bezier(0.32, 0.72, 0, 1) — Apple's standard ease-out.
// ---------------------------------------------------------------------------

// ---- avatar/palette -------------------------------------------------------

const AVATAR_PALETTE = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-fuchsia-500',
] as const;

function hashToIndex(id: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % modulo;
}

function firstLetter(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '?';
}

// ---- SVG icons (crisp at every size, no emoji rendering inconsistencies) --

function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5a.5.5 0 0 1 .5.5v.585a4.5 4.5 0 0 1 3.5 4.385V9l.79 1.316A1 1 0 0 1 11.93 12H4.07a1 1 0 0 1-.857-1.684L4 9V6.97A4.5 4.5 0 0 1 7.5 2.585V2a.5.5 0 0 1 .5-.5Zm-1.5 12a1.5 1.5 0 1 0 3 0h-3Z" />
    </svg>
  );
}

function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.75a3.25 3.25 0 0 0-3.25 3.25V7H4a1 1 0 0 0-1 1v5.25A1.75 1.75 0 0 0 4.75 15h6.5A1.75 1.75 0 0 0 13 13.25V8a1 1 0 0 0-1-1h-.75V5A3.25 3.25 0 0 0 8 1.75Zm1.75 5.25V5a1.75 1.75 0 1 0-3.5 0v2h3.5Z" />
    </svg>
  );
}

function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5 6.5 11.5 12.5 5" />
    </svg>
  );
}

function WarnIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5c.4 0 .77.22.96.58l6 11A1.1 1.1 0 0 1 14 14.75H2a1.1 1.1 0 0 1-.96-1.67l6-11c.19-.36.56-.58.96-.58Zm-.75 4.75v3.5a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-1.5 0ZM8 12.5a.85.85 0 1 0 0-1.7.85.85 0 0 0 0 1.7Z" />
    </svg>
  );
}

function InfoIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM7.25 6.75v5a.75.75 0 0 0 1.5 0v-5a.75.75 0 0 0-1.5 0ZM8 5.25a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
    </svg>
  );
}

function CloseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l8 8M12 4 4 12" />
    </svg>
  );
}

// ---- icon resolvers -------------------------------------------------------

function SystemIcon({ icon, className = '' }: { icon: ToastIcon; className?: string }) {
  switch (icon) {
    case 'permission': return <LockIcon className={className} />;
    case 'task':       return <CheckIcon className={className} />;
    case 'error':      return <WarnIcon className={className} />;
    case 'system':
    default:           return <BellIcon className={className} />;
  }
}

function TypeFallbackIcon({ type, className = '' }: { type: Toast['type']; className?: string }) {
  switch (type) {
    case 'success': return <CheckIcon className={className} />;
    case 'error':   return <WarnIcon className={className} />;
    case 'info':
    default:        return <InfoIcon className={className} />;
  }
}

const TYPE_TINT: Record<Toast['type'], string> = {
  success: 'bg-emerald-500/15 text-emerald-300',
  error: 'bg-rose-500/15 text-rose-300',
  info: 'bg-sky-500/15 text-sky-300',
};

// ---- Avatar ---------------------------------------------------------------

interface AvatarProps {
  projectId?: string;
  projectName?: string | null;
  icon?: ToastIcon;
  type?: Toast['type'];
}

function Avatar({ projectId, projectName, icon, type }: AvatarProps) {
  if (projectId && projectName) {
    return (
      <div
        className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center text-white text-sm font-semibold tracking-tight ${
          AVATAR_PALETTE[hashToIndex(projectId, AVATAR_PALETTE.length)]
        } shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]`}
        aria-hidden
      >
        {firstLetter(projectName)}
      </div>
    );
  }

  const tintClass = icon ? 'bg-white/10 text-white/85' : (type ? TYPE_TINT[type] : 'bg-white/10 text-white/85');

  return (
    <div
      className={`w-8 h-8 flex-shrink-0 rounded-full flex items-center justify-center ${tintClass}
                  shadow-[inset_0_1px_0_rgba(255,255,255,0.1)]`}
      aria-hidden
    >
      {icon ? <SystemIcon icon={icon} className="w-3.5 h-3.5" /> : type ? <TypeFallbackIcon type={type} className="w-3.5 h-3.5" /> : <BellIcon className="w-3.5 h-3.5" />}
    </div>
  );
}

// ---- Closed pill ----------------------------------------------------------

interface PillPreview {
  title: string;
  icon?: ToastIcon;
  type?: Toast['type'];
  projectId?: string;
  projectName?: string | null;
}

interface ClosedPillProps {
  unreadCount: number;
  hasPendingAttention: boolean;
  preview: PillPreview | null;
  onClick: () => void;
}

function ClosedPill({ unreadCount, hasPendingAttention, preview, onClick }: ClosedPillProps) {
  // Leading icon: app logo by default, or the pending-toast's icon tint
  const leading = preview?.projectId && preview.projectName ? (
    <div
      className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-semibold ${
        AVATAR_PALETTE[hashToIndex(preview.projectId, AVATAR_PALETTE.length)]
      }`}
      aria-hidden
    >
      {firstLetter(preview.projectName)}
    </div>
  ) : preview?.icon ? (
    <SystemIcon icon={preview.icon} className="w-3.5 h-3.5 text-white/90" />
  ) : (
    <img
      src="/logo.png"
      alt=""
      className="w-5 h-5 rounded-full ring-1 ring-white/15 object-cover"
      draggable={false}
    />
  );

  // Trailing: pulse dot for attention, or numbered badge for unread
  const trailing = hasPendingAttention ? (
    <span className="relative w-1.5 h-1.5 flex-shrink-0">
      <span className="absolute inset-0 rounded-full bg-amber-400/70 animate-ping" />
      <span className="relative inline-block w-1.5 h-1.5 rounded-full bg-amber-400" />
    </span>
  ) : unreadCount > 0 ? (
    <span className="min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-white/15 text-white text-[10px] font-semibold leading-none tabular-nums">
      {unreadCount > 99 ? '99+' : unreadCount}
    </span>
  ) : null;

  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="notch-pill"
      className="pointer-events-auto group flex items-center gap-2 h-8 pl-1.5 pr-3
                 rounded-full
                 bg-black/65 backdrop-blur-2xl backdrop-saturate-150
                 border border-white/[0.08]
                 shadow-[inset_0_1px_0_rgba(255,255,255,0.12),0_10px_30px_-8px_rgba(0,0,0,0.55)]
                 hover:bg-black/75 hover:border-white/[0.14]
                 active:scale-[0.98]
                 transition-all duration-200 ease-out"
    >
      {leading}
      <span className="text-[12px] font-medium tracking-tight text-white/92 truncate max-w-[220px]">
        {preview?.title ?? 'MyClaudia'}
      </span>
      {trailing}
    </button>
  );
}

// ---- Opened panel row -----------------------------------------------------

interface OpenedRowProps {
  id: string;
  title: string;
  description?: string;
  createdAt: number;
  projectId?: string;
  projectName?: string | null;
  icon?: ToastIcon;
  type?: Toast['type'];
  status?: 'running' | 'completed' | 'failed';
  isUnread?: boolean;
  onClick?: () => void;
  onDismiss?: () => void;
}

function OpenedRow({
  title, description, createdAt,
  projectId, projectName, icon, type, status, isUnread,
  onClick, onDismiss,
}: OpenedRowProps) {
  const label = projectName ?? 'MyClaudia';
  const statusDot = status === 'running' ? 'bg-amber-400 animate-pulse'
    : status === 'failed' ? 'bg-rose-400'
    : status === 'completed' ? 'bg-emerald-400'
    : null;

  return (
    <div
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : -1}
      onClick={onClick}
      onKeyDown={(e) => {
        if (onClick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onClick();
        }
      }}
      className={`group relative flex items-start gap-3 px-3 py-2.5 rounded-xl
                  ${onClick ? 'cursor-pointer hover:bg-white/[0.06]' : ''}
                  transition-colors duration-150`}
    >
      <Avatar projectId={projectId} projectName={projectName} icon={icon} type={type} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 text-[13px] tracking-tight text-white">
          <span className="text-white/55 truncate max-w-[8rem]">{label}</span>
          <span className="text-white/25">·</span>
          <span className={`truncate flex-1 ${isUnread ? 'font-semibold' : 'font-medium'}`}>{title}</span>
          {statusDot && <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDot}`} />}
        </div>
        {description && (
          <p className="mt-0.5 text-[11.5px] leading-snug text-white/55 line-clamp-2">{description}</p>
        )}
      </div>

      <div className="flex-shrink-0 flex items-start relative min-w-[3rem] justify-end pt-0.5">
        <span className="text-[10.5px] text-white/40 tabular-nums group-hover:opacity-0 transition-opacity">
          {timeAgo(createdAt)}
        </span>
        {onDismiss && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDismiss(); }}
            aria-label="Dismiss"
            className="absolute right-0 top-0 w-5 h-5 flex items-center justify-center rounded-md
                       text-white/50 hover:text-white hover:bg-white/10
                       opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <CloseIcon className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ---- Opened panel ---------------------------------------------------------

const TAB_EMPTY_TEXT: Record<NotchTab, { title: string; subtitle: string }> = {
  sessions: { title: "You're all caught up.", subtitle: 'Task results and session events will appear here.' },
  claudia: { title: 'No Claudia activity.', subtitle: 'Claudia Chat task results and updates will appear here.' },
  approvals: { title: 'No pending approvals.', subtitle: 'Permission requests and AI reviews will appear here.' },
  system: { title: 'All systems normal.', subtitle: 'Connection and sync status will appear here.' },
};

function OpenedPanel({ onRequestClose }: { onRequestClose: () => void }) {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.remove);
  const projects = useProjectStore((s) => s.projects);
  const { items, hydrated, setLoading, removeItem } = useNotificationFeedStore();
  const { sendMessage } = useConnection();
  const { selectSession } = useSelectionCoordinator();
  const setHovering = useNotchPanelStore((s) => s.setHovering);
  const activeTab = useNotchPanelStore((s) => s.activeTab);
  const setActiveTab = useNotchPanelStore((s) => s.setActiveTab);

  useEffect(() => {
    if (hydrated) return;
    setLoading(true);
    sendMessage({ type: 'get_notifications', limit: 50 });
  }, [hydrated, sendMessage, setLoading]);

  // Filter by active tab
  const filteredToasts = useMemo(
    () => toasts.filter((t) => (t.category ?? classifyToast(t)) === activeTab),
    [toasts, activeTab],
  );
  const filteredItems = useMemo(
    () => items.filter((i) => classifyFeedItem(i) === activeTab),
    [items, activeTab],
  );

  // Per-tab unread counts
  const unreadCounts = useMemo(() => {
    const counts: Record<NotchTab, number> = { sessions: 0, claudia: 0, approvals: 0, system: 0 };
    // Count toasts per tab (all toasts are "unread")
    for (const t of toasts) counts[t.category ?? classifyToast(t)]++;
    // Count unread feed items per tab
    for (const i of items) {
      if (!i.readAt) counts[classifyFeedItem(i)]++;
    }
    return counts;
  }, [toasts, items]);

  const handleMarkAllRead = useCallback(() => {
    const unreadIds = filteredItems.filter((i) => !i.readAt).map((i) => i.id);
    if (unreadIds.length > 0) {
      sendMessage({ type: 'mark_notifications_read', itemIds: unreadIds });
      useNotificationFeedStore.getState().markRead(unreadIds);
    }
  }, [filteredItems, sendMessage]);

  const handleClearRead = useCallback(() => {
    // Only clear read items in the current tab
    const readIds = filteredItems.filter((i) => i.readAt).map((i) => i.id);
    if (readIds.length > 0) {
      sendMessage({ type: 'dismiss_notifications', itemIds: readIds });
      for (const id of readIds) removeItem(id);
    }
  }, [filteredItems, sendMessage, removeItem]);

  const handleFeedItemClick = (item: NotificationItemData) => {
    if (!item.readAt) {
      sendMessage({ type: 'mark_notifications_read', itemIds: [item.id] });
      useNotificationFeedStore.getState().markRead([item.id]);
    }
    if (item.sessionId) {
      selectSession(item.sessionId, { backendId: item.ownerBackendId });
      onRequestClose();
    }
  };

  const handleFeedDismiss = (id: string) => {
    sendMessage({ type: 'dismiss_notifications', itemIds: [id] });
    removeItem(id);
  };

  const tabUnreadCount = unreadCounts[activeTab];
  const hasReadItems = filteredItems.some((i) => i.readAt);
  const emptyText = TAB_EMPTY_TEXT[activeTab];

  return (
    <div
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      className="flex flex-col max-h-[60vh] w-[420px]"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06] flex-shrink-0">
        <span className="text-[13px] font-semibold tracking-tight text-white">Notifications</span>
        <div className="flex items-center gap-1">
          {hasReadItems && (
            <button
              onClick={handleClearRead}
              className="px-2 h-6 text-[11px] text-white/55 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
            >
              Clear read
            </button>
          )}
          {tabUnreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="px-2 h-6 text-[11px] text-white/55 hover:text-white hover:bg-white/[0.06] rounded-md transition-colors"
            >
              Mark all read
            </button>
          )}
          <button
            type="button"
            onClick={onRequestClose}
            aria-label="Close"
            className="w-6 h-6 flex items-center justify-center rounded-md text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors"
          >
            <CloseIcon className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Tab bar */}
      <NotchTabBar activeTab={activeTab} onTabChange={setActiveTab} unreadCounts={unreadCounts} />

      {/* List */}
      <div className="flex-1 overflow-y-auto px-1.5 py-1.5">
        {filteredToasts.length > 0 && (
          <>
            {filteredToasts.map((t) => {
              const projectName = t.projectId
                ? projects.find((p) => p.id === t.projectId)?.name ?? null
                : null;
              return (
                <OpenedRow
                  key={t.id}
                  id={t.id}
                  title={t.title}
                  description={t.message}
                  createdAt={t.createdAt}
                  projectId={t.projectId}
                  projectName={projectName}
                  icon={t.icon}
                  type={t.type}
                  onClick={() => {
                    t.onClick?.();
                    removeToast(t.id);
                  }}
                  onDismiss={() => removeToast(t.id)}
                />
              );
            })}
            {filteredItems.length > 0 && (
              <div className="mx-3 my-1 border-t border-white/[0.04]" />
            )}
          </>
        )}

        {filteredItems.length === 0 && filteredToasts.length === 0 ? (
          <div className="px-6 py-10 text-center">
            <img src="/logo.png" alt="" className="w-10 h-10 mx-auto opacity-40 rounded-xl" draggable={false} />
            <p className="mt-3 text-[13px] text-white/60">{emptyText.title}</p>
            <p className="mt-1 text-[11px] text-white/40">{emptyText.subtitle}</p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const projectName = item.projectId
              ? projects.find((p) => p.id === item.projectId)?.name ?? null
              : null;
            return (
              <OpenedRow
                key={item.id}
                id={item.id}
                title={item.title}
                description={item.summary || item.error}
                createdAt={item.createdAt}
                projectId={item.projectId}
                projectName={projectName}
                status={item.status}
                isUnread={!item.readAt}
                onClick={() => handleFeedItemClick(item)}
                onDismiss={() => handleFeedDismiss(item.id)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

// ---- NotchPanel (root) ----------------------------------------------------

export function NotchPanel() {
  const isOpen = useNotchPanelStore((s) => s.isOpen);
  const toggle = useNotchPanelStore((s) => s.toggle);
  const close = useNotchPanelStore((s) => s.close);
  const lastPreviewTitle = useNotchPanelStore((s) => s.lastPreviewTitle);

  const toasts = useToastStore((s) => s.toasts);
  const projects = useProjectStore((s) => s.projects);
  const unreadCount = useNotificationFeedStore((s) => s.unreadCount);

  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside → close.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (target && containerRef.current && !containerRef.current.contains(target)) {
        close();
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [isOpen, close]);

  const pillPreview: PillPreview | null = useMemo(() => {
    if (toasts.length > 0) {
      const t = toasts[0];
      const projectName = t.projectId
        ? projects.find((p) => p.id === t.projectId)?.name ?? null
        : null;
      return {
        title: t.title,
        icon: t.icon,
        type: t.type,
        projectId: t.projectId,
        projectName,
      };
    }
    if (lastPreviewTitle) {
      return { title: lastPreviewTitle };
    }
    return null;
  }, [toasts, projects, lastPreviewTitle]);

  const hasPendingAttention = useMemo(
    () => toasts.some((t) => t.icon === 'permission' || t.icon === 'error' || t.type === 'error'),
    [toasts],
  );

  // Apple ease-out: cubic-bezier(0.32, 0.72, 0, 1).
  const appleEase = 'cubic-bezier(0.32, 0.72, 0, 1)';

  return (
    <div
      ref={containerRef}
      data-testid="notch-panel"
      className="fixed top-0 left-1/2 -translate-x-1/2 z-40 pt-1 flex flex-col items-center pointer-events-none"
    >
      {/* Closed state */}
      <div
        style={{ transitionTimingFunction: appleEase }}
        className={`transition-all duration-[320ms]
                    ${isOpen ? 'opacity-0 scale-[0.96] -translate-y-1 pointer-events-none h-0 overflow-hidden' : 'opacity-100 scale-100 translate-y-0 h-auto'}`}
      >
        <ClosedPill
          unreadCount={unreadCount}
          hasPendingAttention={hasPendingAttention}
          preview={pillPreview}
          onClick={toggle}
        />
      </div>

      {/* Opened state */}
      <div
        style={{ transitionTimingFunction: appleEase }}
        className={`pointer-events-auto origin-top transition-all duration-[380ms]
                    rounded-[22px]
                    border border-white/[0.08]
                    bg-black/65 backdrop-blur-2xl backdrop-saturate-150
                    shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_20px_50px_-12px_rgba(0,0,0,0.6)]
                    overflow-hidden
                    ${isOpen ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-[0.92] -translate-y-2 pointer-events-none h-0'}`}
      >
        {isOpen && <OpenedPanel onRequestClose={close} />}
      </div>
    </div>
  );
}
