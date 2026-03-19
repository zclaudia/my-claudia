import { RotateCcw, Download, ExternalLink, Archive, ArrowLeft, MoreHorizontal } from 'lucide-react';
import type { Session, Project, ProviderConfig } from '@my-claudia/shared';

const isDesktopTauri = typeof window !== 'undefined'
  && '__TAURI_INTERNALS__' in window
  && !navigator.userAgent.includes('Android');

const isStandaloneSessionWindow = typeof window !== 'undefined'
  && new URLSearchParams(window.location.search).has('sessionWindow');

interface SessionHeaderProps {
  currentSession: Session;
  currentProject: Project | null | undefined;
  providers: ProviderConfig[];
  isMobile: boolean;
  isLoading: boolean;
  isRenamingSession: boolean;
  renameValue: string;
  showSessionMenu: boolean;
  onOpenSidebar?: () => void;
  onReturnToDashboard?: (projectId: string) => void;
  onRenameStart: (currentName: string) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
  onResetProviderSession: () => void;
  onExport: () => void;
  onArchive: () => void;
  onPopOut: () => void;
  onToggleSessionMenu: () => void;
}

export function SessionHeader({
  currentSession,
  currentProject,
  providers,
  isMobile,
  isLoading,
  isRenamingSession,
  renameValue,
  showSessionMenu,
  onOpenSidebar,
  onReturnToDashboard,
  onRenameStart,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
  onResetProviderSession,
  onExport,
  onArchive,
  onPopOut,
  onToggleSessionMenu,
}: SessionHeaderProps) {
  return (
    <div className="flex min-h-[48px] items-center gap-2.5 px-3 py-0 sm:min-h-[36px] sm:px-3.5 sm:py-0 border-b border-border bg-card safe-top-pad">
      {/* Mobile: hamburger menu */}
      {isMobile && onOpenSidebar && (
        <button
          onClick={onOpenSidebar}
          className="flex h-8 w-8 -ml-1 items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground flex-shrink-0"
          aria-label="Open menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      )}
      {/* Back button for background sessions */}
      {currentSession.type === 'background' && onReturnToDashboard && currentSession.projectId && (
        <button
          onClick={() => onReturnToDashboard(currentSession.projectId)}
          className="flex h-8 w-8 items-center justify-center rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors shrink-0"
          title="Back to dashboard"
        >
          <ArrowLeft size={14} />
        </button>
      )}
      {/* Session name — click to rename (disabled for background sessions) */}
      {currentSession.type === 'background' ? (
        <div className="flex flex-1 min-w-0 items-center self-stretch">
          <span className="flex min-w-0 items-center truncate text-[13px] font-semibold leading-none text-foreground">
            {currentSession.name || 'Untitled Session'}
          </span>
        </div>
      ) : isRenamingSession ? (
        <input
          autoFocus
          type="text"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onRenameConfirm();
            if (e.key === 'Escape') onRenameCancel();
          }}
          onBlur={onRenameConfirm}
          className="flex-1 min-w-0 px-2 py-0 text-[13px] font-semibold leading-none bg-muted/60 border-0 rounded-lg shadow-apple-sm focus:ring-1 focus:ring-primary/50 focus:outline-none text-foreground"
        />
      ) : (
        <div className="flex flex-1 min-w-0 items-center self-stretch">
          <button
            onClick={() => onRenameStart(currentSession.name || '')}
            className="flex h-full w-full min-w-0 items-center truncate text-left text-[13px] font-semibold leading-none text-foreground hover:text-primary transition-colors"
            title="Click to rename"
          >
            {currentSession.name || 'Untitled Session'}
          </button>
        </div>
      )}
      <div className="hidden sm:flex min-w-0 shrink-0 items-center gap-1.5 text-[9px] leading-none text-muted-foreground">
        <span className="uppercase leading-none tracking-[0.16em] text-muted-foreground/70">Session</span>
        {(() => {
          const pid = currentSession.providerId || currentProject?.providerId;
          const prov = pid ? providers.find(p => p.id === pid) : undefined;
          const name = prov?.name || prov?.type || 'Claude';
          return (
            <span className="inline-flex h-4 items-center rounded-full border border-border/70 bg-muted/45 px-1.5 text-[9px] font-medium leading-none text-muted-foreground">
              {name}
            </span>
          );
        })()}
      </div>
      {/* Actions (hidden for background sessions) */}
      {currentSession.type !== 'background' && (
        <>
          {/* Desktop: show all buttons inline */}
          {!isMobile && (
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-0.5 rounded-xl border border-border/70 bg-background/85 p-px shadow-sm">
                <button
                  onClick={onResetProviderSession}
                  disabled={isLoading}
                  className={`p-0.5 rounded-md transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed text-muted-foreground' : 'hover:bg-secondary text-muted-foreground hover:text-foreground'}`}
                  title="Reset underlying provider session"
                >
                  <RotateCcw size={12} />
                </button>
                <button
                  onClick={onExport}
                  className="p-0.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                  title="Export as Markdown"
                >
                  <Download size={12} />
                </button>
                {isDesktopTauri && !isStandaloneSessionWindow && (
                  <button
                    onClick={onPopOut}
                    className="p-0.5 rounded-md hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors"
                    title="Open in new window"
                  >
                    <ExternalLink size={12} />
                  </button>
                )}
              </div>
              <button
                onClick={onArchive}
                className="p-0.5 rounded-lg border border-transparent text-muted-foreground transition-colors hover:bg-destructive/8 hover:text-destructive"
                title="Archive session"
              >
                <Archive size={12} />
              </button>
            </div>
          )}
          {/* Mobile: collapse actions into "..." dropdown */}
          {isMobile && (
            <div className="relative shrink-0">
              <button
                onClick={onToggleSessionMenu}
                className="flex h-8 w-8 items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                title="Session actions"
              >
                <MoreHorizontal size={16} strokeWidth={1.75} />
              </button>
              {showSessionMenu && (
                <>
                  <div className="fixed inset-0 z-[70]" onClick={onToggleSessionMenu} />
                  <div className="fixed right-3 top-[calc(env(safe-area-inset-top,0px)+42px)] z-[80] min-w-[180px] overflow-hidden rounded-xl border border-border/80 bg-card shadow-2xl">
                    <button
                      onClick={() => { onResetProviderSession(); onToggleSessionMenu(); }}
                      disabled={isLoading}
                      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 text-foreground hover:bg-muted disabled:opacity-50"
                    >
                      <RotateCcw size={14} />
                      Reset Session
                    </button>
                    <button
                      onClick={() => { onExport(); onToggleSessionMenu(); }}
                      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 text-foreground hover:bg-muted"
                    >
                      <Download size={14} />
                      Export Markdown
                    </button>
                    <button
                      onClick={() => { onArchive(); onToggleSessionMenu(); }}
                      className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 text-foreground hover:bg-muted"
                    >
                      <Archive size={14} />
                      Archive
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
