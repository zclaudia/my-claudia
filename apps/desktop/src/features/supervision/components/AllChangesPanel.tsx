import type { ProjectChange } from '@my-claudia/shared';
import { changeStatusLabel } from './supervisor-utils';

interface AllChangesPanelProps {
  filteredChanges: ProjectChange[];
  changesFilter: 'all' | 'active' | 'completed' | 'cancelled';
  previewChangeId: string | null;
  loading: boolean;
  onFilterChange: (filter: 'all' | 'active' | 'completed' | 'cancelled') => void;
  onPreviewChange: (change: ProjectChange) => void;
}

export function AllChangesPanel({
  filteredChanges,
  changesFilter,
  previewChangeId,
  loading,
  onFilterChange,
  onPreviewChange,
}: AllChangesPanelProps) {
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">All Changes</div>
          <div className="mt-1 text-xs text-muted-foreground">Project-level change list with lightweight filters.</div>
        </div>
        <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">
          {filteredChanges.length}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {(['all', 'active', 'completed', 'cancelled'] as const).map((filter) => (
          <button
            key={filter}
            type="button"
            onClick={() => onFilterChange(filter)}
            className={`rounded-md px-2 py-1 text-[11px] transition-colors ${
              changesFilter === filter
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {filter === 'all' ? 'All' : filter[0]!.toUpperCase() + filter.slice(1)}
          </button>
        ))}
      </div>

      <div className="mt-3 space-y-2">
        {filteredChanges.map((change) => (
          <div
            key={change.id}
            className={`rounded-md border px-3 py-2 transition-colors ${
              previewChangeId === change.id
                ? 'border-primary bg-primary/5'
                : 'border-border bg-secondary/20'
            }`}
          >
            <button
              type="button"
              onClick={() => onPreviewChange(change)}
              aria-label={`Preview ${change.title}`}
              disabled={loading}
              className="w-full text-left disabled:opacity-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-foreground">{change.title}</div>
                  <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{change.summary}</div>
                </div>
                <span className="rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  {changeStatusLabel[change.status] ?? change.status}
                </span>
              </div>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
