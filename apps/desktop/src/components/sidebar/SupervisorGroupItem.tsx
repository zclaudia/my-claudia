interface SupervisorGroupItemProps {
  onSelect: () => void;
  isSelected: boolean;
  isActive?: boolean;
  taskCount: number;
  taskChildren: React.ReactNode;
}

/**
 * Lightweight supervisor section header.
 * Clicking selects the main supervisor session.
 * Task sessions are listed directly below.
 */
export function SupervisorGroupItem({
  onSelect,
  isSelected,
  isActive,
  taskCount,
  taskChildren,
}: SupervisorGroupItemProps) {
  return (
    <li className="relative" data-testid="supervisor-group">
      <div>
        {/* Card header — clickable to select the supervisor session */}
        <button
          onClick={onSelect}
          className={`w-full flex items-center gap-1.5 px-2 py-1 rounded-lg transition-colors ${
            isSelected
              ? 'text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className={`text-[10px] font-medium uppercase tracking-wider ${
            isSelected ? 'text-primary' : 'text-muted-foreground/60'
          }`}>
            Supervisor
          </span>
          {isActive && (
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
          )}
          {taskCount > 0 && (
            <span className={`ml-auto text-[10px] ${
              isSelected ? 'text-muted-foreground/60' : 'text-muted-foreground/50'
            }`}>
              {taskCount} task{taskCount > 1 ? 's' : ''}
            </span>
          )}
        </button>

        {/* Task sessions — shown directly under supervisor */}
        {taskCount > 0 && (
          <ul className="mt-0.5 space-y-0.5 pl-2">
            {taskChildren}
          </ul>
        )}
      </div>
    </li>
  );
}
