import { Bot } from 'lucide-react';

interface SupervisorGroupItemProps {
  onSelect: () => void;
  isSelected: boolean;
  isActive?: boolean;
  phase?: string;
  taskCount: number;
  taskChildren: React.ReactNode;
}

const phaseConfig: Record<string, { label: string; color: string }> = {
  active:  { label: 'Active',  color: 'bg-green-500/15 text-green-600 dark:text-green-400' },
  paused:  { label: 'Paused',  color: 'bg-yellow-500/15 text-yellow-600 dark:text-yellow-400' },
  setup:   { label: 'Setup',   color: 'bg-blue-500/15 text-blue-600 dark:text-blue-400' },
  idle:    { label: 'Idle',    color: 'bg-gray-500/15 text-gray-500' },
  archived:{ label: 'Archived',color: 'bg-gray-500/15 text-gray-400' },
};

/**
 * Card-style supervisor dashboard entry.
 * Clicking opens the project dashboard.
 * Task sessions are listed directly below.
 */
export function SupervisorGroupItem({
  onSelect,
  isSelected,
  isActive,
  phase,
  taskCount,
  taskChildren,
}: SupervisorGroupItemProps) {
  const cfg = phase ? phaseConfig[phase] : undefined;

  return (
    <li className="relative" data-testid="supervisor-group">
      <div>
        {/* Card — clickable to open dashboard */}
        <button
          onClick={onSelect}
          className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg border transition-colors ${
            isSelected
              ? 'bg-primary/10 border-primary/30 text-foreground'
              : 'bg-muted/40 border-transparent hover:bg-muted/70 text-foreground/80 hover:text-foreground'
          }`}
        >
          <div className={`shrink-0 w-6 h-6 rounded-md flex items-center justify-center ${
            isSelected ? 'bg-primary/15 text-primary' : 'bg-muted-foreground/10 text-muted-foreground/60'
          }`}>
            <Bot className="w-3.5 h-3.5" />
          </div>

          <div className="flex-1 min-w-0 flex items-center gap-1.5">
            <span className="text-xs font-semibold tracking-wide">
              Supervisor
            </span>
            {isActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse shrink-0" />
            )}
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {cfg && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${cfg.color}`}>
                {cfg.label}
              </span>
            )}
            {taskCount > 0 && (
              <span className="text-[10px] text-muted-foreground/60">
                {taskCount} task{taskCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
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
