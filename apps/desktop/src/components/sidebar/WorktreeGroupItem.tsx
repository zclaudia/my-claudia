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
}

export function WorktreeGroupItem({
  group,
  isExpanded,
  onToggle,
  children,
  isMobile,
}: WorktreeGroupItemProps) {
  return (
    <div className="mt-1">
      {/* Group header */}
      <button
        onClick={onToggle}
        className={`w-full flex items-center gap-1.5 px-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors ${
          isMobile ? 'min-h-[36px] py-1' : 'h-6'
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

      {/* Expanded children */}
      {isExpanded && (
        <ul className="ml-3 mt-0.5 space-y-0.5">
          {children}
        </ul>
      )}
    </div>
  );
}
