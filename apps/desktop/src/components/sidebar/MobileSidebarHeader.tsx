import { Bell } from 'lucide-react';
import { BrandMark } from '../BrandMark';
import { ServerSelector } from '../ServerSelector';
import type { MobileSidebarHeaderProps } from './types';

export function MobileSidebarHeader({
  onClose,
  onOpenNotifications,
  isNotificationsOpen,
  notificationUnreadCount,
  isClaudiaExpanded,
  setClaudiaExpanded,
  hasClaudiaPermissionPending,
  hasClaudiaUnread,
  hasClaudiaRunning,
}: MobileSidebarHeaderProps) {
  return (
    <>
      {/* Header with close button */}
      <div className="h-[72px] border-b border-border flex items-center justify-between px-4">
        <h1 className="font-semibold text-lg">MyClaudia</h1>
        <button
          onClick={onClose}
          className="p-2 min-w-[44px] min-h-[44px] rounded hover:bg-secondary active:bg-secondary text-muted-foreground hover:text-foreground flex items-center justify-center"
          title="Close menu"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {/* Server Selector */}
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ServerSelector />
          </div>
          <button
            onClick={() => {
              onOpenNotifications?.();
              onClose?.();
            }}
            className={`relative h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors ${
              isNotificationsOpen ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
            title="Notifications"
            aria-label="Open notifications"
          >
            <Bell size={18} strokeWidth={1.75} />
            {notificationUnreadCount > 0 && !isNotificationsOpen && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center bg-primary text-primary-foreground text-[9px] font-medium rounded-full px-0.5">
                {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
              </span>
            )}
          </button>
          <button
            onClick={() => {
              setClaudiaExpanded(true);
              onClose?.();
            }}
            className={`relative h-10 w-10 flex-shrink-0 flex items-center justify-center rounded-full transition-colors ${
              isClaudiaExpanded ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            }`}
            title="Open Claudia"
            aria-label="Open Claudia"
          >
            <BrandMark className="w-[18px] h-[18px] object-contain" />
            {(hasClaudiaPermissionPending || hasClaudiaUnread || hasClaudiaRunning) && !isClaudiaExpanded && (
              <span
                className={`absolute top-1 right-1 w-2 h-2 rounded-full ${
                  hasClaudiaPermissionPending
                    ? 'bg-orange-500'
                    : hasClaudiaUnread
                    ? 'bg-primary animate-pulse'
                    : 'bg-amber-500 animate-pulse'
                }`}
              />
            )}
          </button>
        </div>
      </div>
    </>
  );
}
