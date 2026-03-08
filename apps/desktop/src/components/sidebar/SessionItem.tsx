import type { Session } from '@my-claudia/shared';

interface SessionItemProps {
  session: Session;
  isSelected: boolean;
  onSelect: (id: string) => void;
  hasPending: boolean;
  isActive?: boolean;
  providerName?: string;
  worktreeBranch?: string;
  isMobile?: boolean;
}

const ROLE_BADGES: Record<string, { label: string; className: string }> = {
  main: { label: 'main', className: 'bg-blue-500/20 text-blue-400' },
  review: { label: 'review', className: 'bg-purple-500/20 text-purple-400' },
  checkpoint: { label: 'check', className: 'bg-orange-500/20 text-orange-400' },
};

/** Resolve status label based on session state. Returns null for idle sessions. */
function getStatusLabel(session: Session, isActive?: boolean, hasPending?: boolean): { text: string; className: string; pulse?: boolean } | null {
  if (hasPending) return { text: 'waiting', className: 'text-amber-500', pulse: true };
  if (session.lastRunStatus === 'interrupted') return { text: 'interrupted', className: 'text-red-400' };
  if (session.planStatus === 'planning') return { text: 'planning', className: 'text-blue-400' };
  if (session.planStatus === 'planned') return { text: 'planned', className: 'text-yellow-500' };
  if (session.planStatus === 'executing') return { text: 'running', className: 'text-green-500', pulse: true };
  if (isActive) return { text: 'running', className: 'text-green-500', pulse: true };
  return null;
}

export function SessionItem({
  session,
  isSelected,
  onSelect,
  hasPending,
  isActive,
  providerName,
  worktreeBranch,
  isMobile,
}: SessionItemProps) {
  const isTask = session.projectRole === 'task';
  const roleBadge = session.projectRole ? ROLE_BADGES[session.projectRole] : undefined;
  const statusLabel = getStatusLabel(session, isActive, hasPending);

  // Task items under Supervisor use lighter styling
  const selectedClass = isTask
    ? 'bg-muted/60 text-foreground'
    : 'bg-primary/15 text-foreground';
  const unselectedClass = isTask
    ? `text-muted-foreground/70 hover:bg-muted/40 ${isMobile ? 'active:bg-muted/40' : ''} hover:text-foreground`
    : `text-muted-foreground hover:bg-secondary ${isMobile ? 'active:bg-secondary' : ''} hover:text-foreground`;

  // Strip "Task: " prefix for task items (redundant under Tasks section)
  const displayName = isTask
    ? (session.name || 'Untitled Task').replace(/^Task:\s*/i, '')
    : (session.name || 'Untitled Session');

  return (
    <li className="relative" data-testid="session-item">
      <button
        onClick={() => onSelect(session.id)}
        className={`w-full text-left px-2 rounded-lg truncate flex items-center gap-1 ${
          isTask ? 'text-xs' : 'text-sm'
        } ${
          isMobile ? 'min-h-[44px]' : 'h-7'
        } ${isSelected ? selectedClass : unselectedClass}`}
      >
        <span className="truncate">{displayName}</span>
        {/* Project role badge */}
        {roleBadge && (
          <span className={`text-[9px] px-1 rounded font-medium shrink-0 ${roleBadge.className}`}>
            {roleBadge.label}
          </span>
        )}
        {/* Provider name tag (for regular sessions, only when idle) */}
        {!session.projectRole && providerName && !statusLabel && (
          <span className={`text-[9px] px-1 rounded shrink-0 ${
            isSelected ? 'bg-primary/15 text-primary' : 'bg-muted-foreground/10 text-muted-foreground/60'
          }`}>
            {providerName}
          </span>
        )}
        {/* Read-only lock icon */}
        {session.isReadOnly && (
          <svg className="w-3 h-3 shrink-0 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
            <path d="M7 11V7a5 5 0 0 1 10 0v4" />
          </svg>
        )}
        {/* Worktree branch indicator */}
        {!session.projectRole && worktreeBranch && (
          <span className={`text-[9px] truncate max-w-[60px] shrink-0 ${
            isSelected ? 'text-foreground/50' : 'text-muted-foreground/50'
          }`} title={worktreeBranch}>
            {worktreeBranch}
          </span>
        )}
        {/* Status label (right side) */}
        {statusLabel && (
          <span className={`ml-auto flex items-center gap-1 shrink-0 text-[9px] font-medium ${statusLabel.className}`}>
            {statusLabel.pulse && (
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
            )}
            {statusLabel.text}
          </span>
        )}
      </button>
    </li>
  );
}
