import { SquareStack, ChevronsRight, ChevronsLeft } from 'lucide-react';
import { emit as emitTauri } from '@tauri-apps/api/event';
import { NOTCH_EVENT } from '../services/notchBridge';
import { openWindowManagerWindow } from '../utils/windowManagerWindow';
import { ServerSelector } from '../components/ServerSelector';
import { BrandMark } from '../components/BrandMark';
import { PluginWindowButtons } from './PluginDock';

interface AppHeaderProps {
  isMobile: boolean;
  isAgentExpanded: boolean;
  sidebarCollapsed: boolean;
  notificationUnreadCount: number;
  disableNotifications: boolean;
  onToggleSidebar: () => void;
  onOpenSidebar: () => void;
  onCloseAgent: () => void;
}

export function AppHeader({
  isMobile,
  isAgentExpanded,
  sidebarCollapsed,
  notificationUnreadCount,
  disableNotifications,
  onToggleSidebar,
  onOpenSidebar,
  onCloseAgent,
}: AppHeaderProps) {
  return (
    <header
      className={`h-12 md:h-14 border-b border-border flex items-center px-2 md:px-4 bg-card flex-shrink-0 ${isMobile && !isAgentExpanded ? 'hidden' : ''}`}
      data-tauri-drag-region
    >
      {/* Left section: Logo and app name */}
      <div className="flex items-center gap-2 md:gap-3 flex-shrink-0" data-tauri-drag-region>
        {isMobile && isAgentExpanded ? (
          <button
            onClick={onCloseAgent}
            className="p-2 rounded hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label="Close agent"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        ) : isMobile ? (
          <button
            onClick={onOpenSidebar}
            className="p-2 rounded hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
            aria-label="Open menu"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
        ) : null}

        <div className="hidden md:flex items-center gap-2" data-tauri-drag-region>
          <div className="w-7 h-7 rounded-xl border border-border/70 bg-card/80 dark:bg-white/5 dark:border-white/10 shadow-sm backdrop-blur-sm flex items-center justify-center flex-shrink-0">
            <BrandMark className="w-[1.625rem] h-[1.625rem] object-contain pointer-events-none select-none drop-shadow-sm" />
          </div>
          <span className="font-semibold text-sm text-foreground leading-tight" data-tauri-drag-region>MyClaudia</span>
        </div>

        {!isMobile && (
          <button
            onClick={onToggleSidebar}
            className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground ml-2"
            title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {sidebarCollapsed ? <ChevronsRight size={16} strokeWidth={2} /> : <ChevronsLeft size={16} strokeWidth={2} />}
          </button>
        )}
      </div>

      {/* Center section: Server selector + Feed */}
      <div className="flex-1 flex items-center justify-start ml-2 md:ml-4 min-w-0 gap-2">
        {isMobile && isAgentExpanded ? (
          <span className="font-semibold text-sm text-foreground">Claudia</span>
        ) : isMobile ? null : (
          <>
            <ServerSelector />
            {!disableNotifications && (
              <div className="relative">
                <button
                  onClick={() => { void emitTauri(NOTCH_EVENT.toggle, {}); }}
                  className="relative p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Notifications"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                  {notificationUnreadCount > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[14px] h-[14px] flex items-center justify-center bg-primary text-primary-foreground text-[9px] font-medium rounded-full px-0.5">
                      {notificationUnreadCount > 99 ? '99+' : notificationUnreadCount}
                    </span>
                  )}
                </button>
              </div>
            )}
            <button
              onClick={() => { void openWindowManagerWindow(); }}
              className="p-1.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              title="Windows"
              aria-label="Open window manager"
            >
              <SquareStack size={16} strokeWidth={1.75} />
            </button>
          </>
        )}
      </div>

      <PluginWindowButtons />
    </header>
  );
}
