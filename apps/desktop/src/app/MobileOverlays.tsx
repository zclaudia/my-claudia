import type { RefObject } from 'react';
import { ClaudiaChat } from '../features/claudia/ClaudiaChat';
import { NotificationsPanel } from '../components/notifications/NotificationsPanel';

interface MobileOverlaysProps {
  isAgentExpanded: boolean;
  isFeedOpen: boolean;
  swipeCloseRef: RefObject<HTMLDivElement>;
  agentSwipePreview: { mode: 'open' | 'close' | null; progress: number };
  claudiaSwipePreviewProgress: number;
  claudiaOverlayOpacity: number;
  onCloseAgent: () => void;
  onCloseFeed: () => void;
}

export function MobileOverlays({
  isAgentExpanded,
  isFeedOpen,
  swipeCloseRef,
  agentSwipePreview,
  claudiaSwipePreviewProgress,
  claudiaOverlayOpacity,
  onCloseAgent,
  onCloseFeed,
}: MobileOverlaysProps) {
  return (
    <>
      {/* Dim overlay */}
      {(isAgentExpanded || agentSwipePreview.mode === 'open' || agentSwipePreview.mode === 'close') && (
        <div
          className={`absolute inset-0 z-10 bg-black/100 ${
            agentSwipePreview.mode ? 'transition-none' : 'transition-opacity duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
          }`}
          style={{
            opacity: claudiaOverlayOpacity,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Agent panel (always mounted to preserve state) */}
      <div
        ref={swipeCloseRef}
        className={`absolute inset-0 z-20 bg-background will-change-transform ${
          isAgentExpanded || agentSwipePreview.mode === 'open' ? '' : 'hidden'
        } ${
          agentSwipePreview.mode ? 'transition-none' : 'transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]'
        }`}
        style={{
          transform: isAgentExpanded
            ? `translateX(${agentSwipePreview.mode === 'close' ? claudiaSwipePreviewProgress * 100 : 0}%)`
            : `translateX(${(1 - (agentSwipePreview.mode === 'open' ? claudiaSwipePreviewProgress : 0)) * 100}%)`,
          pointerEvents: isAgentExpanded ? 'auto' : 'none',
          boxShadow: isAgentExpanded || agentSwipePreview.mode === 'open'
            ? `-16px 0 40px rgba(0, 0, 0, ${0.14 + claudiaSwipePreviewProgress * 0.08})`
            : 'none',
        }}
      >
        <button
          onClick={onCloseAgent}
          className="absolute left-0 top-1/2 -translate-y-1/2 z-10
                     flex items-center px-1 py-2
                     bg-zinc-400/60 text-zinc-600 rounded-r-md shadow-sm
                     border border-l-0 border-zinc-300
                     active:bg-zinc-400/80
                     dark:bg-zinc-600/60 dark:text-zinc-400
                     dark:border-zinc-600 dark:active:bg-zinc-600/80"
          title="Close Claudia"
          aria-label="Close Claudia"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
          </svg>
        </button>
        <ClaudiaChat isMobile={true} />
      </div>

      {/* Feed panel */}
      {isFeedOpen && (
        <div className="absolute inset-0 z-20 bg-background">
          <button
            onClick={onCloseFeed}
            className="absolute left-0 top-1/2 -translate-y-1/2 z-10
                       flex items-center px-1 py-2
                       bg-zinc-400/60 text-zinc-600 rounded-r-md shadow-sm
                       border border-l-0 border-zinc-300
                       active:bg-zinc-400/80
                       dark:bg-zinc-600/60 dark:text-zinc-400
                       dark:border-zinc-600 dark:active:bg-zinc-600/80"
            title="Close Feed"
          >
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
            </svg>
          </button>
          <NotificationsPanel />
        </div>
      )}
    </>
  );
}
