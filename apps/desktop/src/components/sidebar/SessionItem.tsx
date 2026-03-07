import type { Session } from '@my-claudia/shared';

interface SupervisionInfo {
  id: string;
  status: string;
  goal: string;
  currentIteration: number;
  maxIterations: number;
}

interface SessionItemProps {
  session: Session;
  isSelected: boolean;
  isRenaming: boolean;
  renameValue: string;
  onSelect: (id: string) => void;
  onRenameChange: (v: string) => void;
  onRenameSubmit: (id: string) => void;
  onRenameCancel: () => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
  hasPending: boolean;
  supervisionInfo?: SupervisionInfo;
  isMobile?: boolean;
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  main: { label: 'main', className: 'bg-blue-500/20 text-blue-400' },
  task: { label: 'task', className: 'bg-green-500/20 text-green-400' },
  review: { label: 'review', className: 'bg-purple-500/20 text-purple-400' },
  checkpoint: { label: 'check', className: 'bg-orange-500/20 text-orange-400' },
};

export function SessionItem({
  session,
  isSelected,
  isRenaming,
  renameValue,
  onSelect,
  onRenameChange,
  onRenameSubmit,
  onRenameCancel,
  onContextMenu,
  hasPending,
  supervisionInfo,
  isMobile,
}: SessionItemProps) {
  const roleBadge = session.projectRole ? ROLE_BADGES[session.projectRole] : undefined;

  return (
    <li className="relative group" data-testid="session-item">
      <div className="flex items-center">
        {isRenaming ? (
          <input
            autoFocus
            type="text"
            value={renameValue}
            onChange={(e) => onRenameChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onRenameSubmit(session.id);
              if (e.key === 'Escape') onRenameCancel();
            }}
            onBlur={() => onRenameSubmit(session.id)}
            className={`flex-1 min-w-0 px-2 rounded text-sm bg-secondary border border-border text-foreground outline-none ${
              isMobile ? 'min-h-[44px]' : 'h-7'
            }`}
          />
        ) : (
          <button
            onClick={() => onSelect(session.id)}
            className={`flex-1 min-w-0 text-left px-2 rounded text-sm truncate flex items-center gap-1 border border-transparent ${
              isMobile ? 'min-h-[44px]' : 'h-7'
            } ${
              isSelected
                ? 'bg-primary text-primary-foreground'
                : `text-muted-foreground hover:bg-secondary ${isMobile ? 'active:bg-secondary' : ''} hover:text-foreground`
            }`}
          >
            <span className="truncate">{session.name || 'Untitled Session'}</span>
            {/* Project role badge */}
            {roleBadge && (
              <span className={`text-[9px] px-1 rounded font-medium shrink-0 ${roleBadge.className}`}>
                {roleBadge.label}
              </span>
            )}
            {/* Pending permission indicator */}
            {hasPending && (
              <span className="ml-auto w-2 h-2 rounded-full bg-amber-500 animate-pulse shrink-0" title="Pending permission" />
            )}
            {/* Supervision v1 status dot */}
            {supervisionInfo && !hasPending && (
              <span
                className={`ml-auto w-2 h-2 rounded-full shrink-0 ${
                  supervisionInfo.status === 'active'
                    ? 'bg-green-500 animate-pulse'
                    : supervisionInfo.status === 'paused'
                      ? 'bg-yellow-500'
                      : ''
                }`}
                title={`Supervised: ${supervisionInfo.goal} (${supervisionInfo.currentIteration}/${supervisionInfo.maxIterations})`}
              />
            )}
          </button>
        )}
        {/* Session menu button */}
        <button
          onClick={(e) => onContextMenu(e, session.id)}
          className={`flex-shrink-0 flex items-center justify-center rounded ${
            isMobile
              ? 'w-10 h-10 hover:bg-secondary active:bg-secondary'
              : 'w-7 h-7 opacity-0 group-hover:opacity-100 hover:bg-secondary'
          }`}
        >
          <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
          </svg>
        </button>
      </div>
    </li>
  );
}
