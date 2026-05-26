import type { WorktreeGroup } from './worktreeGrouping';

function BranchIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M6 3v12m0 0a3 3 0 100 6 3 3 0 000-6zm0 0c3.314 0 6-2.686 6-6m0-6a3 3 0 100 6 3 3 0 000-6z" />
    </svg>
  );
}

interface WorktreeGroupItemProps {
  group: WorktreeGroup;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
  isMobile?: boolean;
  canDelete?: boolean;
  onDelete?: () => void;
  deleteTitle?: string;
}

export function WorktreeGroupItem({
  group,
  isExpanded,
  onToggle,
  children,
  isMobile,
  canDelete = false,
  onDelete,
  deleteTitle = 'Remove worktree',
}: WorktreeGroupItemProps) {
  return (
    <div className="mt-1">
      {/* Group header */}
      <div className="group flex items-center gap-1">
        <button
          onClick={onToggle}
          className={`flex-1 min-w-0 flex items-center gap-1.5 px-1 rounded-md text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ${
            isMobile ? 'min-h-[36px] py-1' : 'h-7'
          }`}
        >
          {/* Chevron */}
          <svg
            className={`w-3 h-3 shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
            fill="none" stroke="currentColor" viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
          </svg>

          <BranchIcon className="w-3 h-3 shrink-0" />

          <span className="truncate font-medium">
            {group.label}
          </span>

          <span className="ml-auto text-[10px] text-muted-foreground/60 shrink-0">
            {group.sessions.length}
          </span>
        </button>

        {canDelete && onDelete && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className={`rounded-md text-muted-foreground hover:text-red-500 hover:bg-red-500/10 transition-colors ${
              isMobile
                ? 'min-h-[36px] min-w-[36px] opacity-100'
                : 'h-7 w-7 opacity-0 group-hover:opacity-100'
            }`}
            title={deleteTitle}
            aria-label={deleteTitle}
          >
            <svg className="w-3.5 h-3.5 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
          </button>
        )}
      </div>

      {/* Expanded children */}
      {isExpanded && (
        <div className="ml-2 mt-0.5">
          {children}
        </div>
      )}
    </div>
  );
}
