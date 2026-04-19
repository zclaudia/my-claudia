import type { Toast, ToastIcon } from '../stores/toastStore';
import { timeAgo } from '../utils/timeAgo';
import { NOTCH_TABS, NOTCH_TAB_LABELS, type NotchTab } from '../utils/notchTabCategory';

// ---------------------------------------------------------------------------
// Pure visual building blocks used by both:
//  - components/NotchPanel.tsx         (in-window legacy usage, mobile fallback)
//  - components/NotchWindow.tsx        (independent always-on-top Tauri window)
//
// No store or context access — all data comes from props. Visual only.
// ---------------------------------------------------------------------------

export const AVATAR_PALETTE = [
  'bg-sky-500',
  'bg-violet-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-fuchsia-500',
] as const;

export function hashToIndex(id: string, modulo: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % modulo;
}

export function firstLetter(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed[0]!.toUpperCase() : '?';
}

// ---- SVG icons ------------------------------------------------------------

export function BellIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5a.5.5 0 0 1 .5.5v.585a4.5 4.5 0 0 1 3.5 4.385V9l.79 1.316A1 1 0 0 1 11.93 12H4.07a1 1 0 0 1-.857-1.684L4 9V6.97A4.5 4.5 0 0 1 7.5 2.585V2a.5.5 0 0 1 .5-.5Zm-1.5 12a1.5 1.5 0 1 0 3 0h-3Z" />
    </svg>
  );
}

export function LockIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.75a3.25 3.25 0 0 0-3.25 3.25V7H4a1 1 0 0 0-1 1v5.25A1.75 1.75 0 0 0 4.75 15h6.5A1.75 1.75 0 0 0 13 13.25V8a1 1 0 0 0-1-1h-.75V5A3.25 3.25 0 0 0 8 1.75Zm1.75 5.25V5a1.75 1.75 0 1 0-3.5 0v2h3.5Z" />
    </svg>
  );
}

export function CheckIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 8.5 6.5 11.5 12.5 5" />
    </svg>
  );
}

export function WarnIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5c.4 0 .77.22.96.58l6 11A1.1 1.1 0 0 1 14 14.75H2a1.1 1.1 0 0 1-.96-1.67l6-11c.19-.36.56-.58.96-.58Zm-.75 4.75v3.5a.75.75 0 0 0 1.5 0v-3.5a.75.75 0 0 0-1.5 0ZM8 12.5a.85.85 0 1 0 0-1.7.85.85 0 0 0 0 1.7Z" />
    </svg>
  );
}

export function InfoIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="currentColor">
      <path d="M8 1.5a6.5 6.5 0 1 1 0 13 6.5 6.5 0 0 1 0-13ZM7.25 6.75v5a.75.75 0 0 0 1.5 0v-5a.75.75 0 0 0-1.5 0ZM8 5.25a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z" />
    </svg>
  );
}

export function CloseIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 4l8 8M12 4 4 12" />
    </svg>
  );
}

export function SystemIcon({ icon, className = '' }: { icon: ToastIcon; className?: string }) {
  switch (icon) {
    case 'permission': return <LockIcon className={className} />;
    case 'task':       return <CheckIcon className={className} />;
    case 'error':      return <WarnIcon className={className} />;
    case 'system':
    default:           return <BellIcon className={className} />;
  }
}

export function TypeFallbackIcon({ type, className = '' }: { type: Toast['type']; className?: string }) {
  switch (type) {
    case 'success': return <CheckIcon className={className} />;
    case 'error':   return <WarnIcon className={className} />;
    case 'info':
    default:        return <InfoIcon className={className} />;
  }
}

export const TYPE_TINT: Record<Toast['type'], string> = {
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

export function Avatar({ projectId, projectName, icon, type }: AvatarProps) {
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

export interface PillPreview {
  title: string;
  icon?: ToastIcon;
  type?: Toast['type'];
  projectId?: string;
  projectName?: string | null;
}

export interface ClosedPillProps {
  unreadCount: number;
  hasPendingAttention: boolean;
  preview: PillPreview | null;
  onClick: () => void;
  /** Logo URL (project can override, default MyClaudia logo). */
  logoUrl?: string;
}

export function ClosedPill({ unreadCount, hasPendingAttention, preview, onClick, logoUrl = '/logo.png' }: ClosedPillProps) {
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
      src={logoUrl}
      alt=""
      className="w-5 h-5 rounded-full ring-1 ring-white/15 object-cover"
      draggable={false}
    />
  );

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

// ---- Opened row -----------------------------------------------------------

export interface OpenedRowProps {
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

// ---- Tab bar ---------------------------------------------------------------

export interface NotchTabBarProps {
  activeTab: NotchTab;
  onTabChange: (tab: NotchTab) => void;
  unreadCounts: Record<NotchTab, number>;
}

export function NotchTabBar({ activeTab, onTabChange, unreadCounts }: NotchTabBarProps) {
  return (
    <div className="flex items-center gap-0.5 mx-2 my-1.5 p-0.5 rounded-lg bg-white/[0.06]">
      {NOTCH_TABS.map((tab) => {
        const isActive = tab === activeTab;
        const count = unreadCounts[tab];
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onTabChange(tab)}
            className={`flex-1 flex items-center justify-center gap-1 h-7 rounded-md text-[11.5px] tracking-tight transition-all duration-150
                        ${isActive
                          ? 'bg-white/[0.1] text-white font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.2)]'
                          : 'text-white/50 hover:text-white/70'}`}
          >
            {NOTCH_TAB_LABELS[tab]}
            {count > 0 && (
              <span className={`min-w-[14px] h-3.5 px-1 flex items-center justify-center rounded-full text-[9px] font-semibold leading-none tabular-nums
                               ${isActive ? 'bg-white/15 text-white' : 'bg-white/10 text-white/50'}`}>
                {count > 99 ? '99+' : count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function OpenedRow({
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
