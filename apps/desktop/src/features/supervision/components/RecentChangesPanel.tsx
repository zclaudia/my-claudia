import type { ProjectChange } from '@my-claudia/shared';
import { changeStatusLabel, type PreviewDocTarget } from './supervisor-utils';

interface RecentChangesPanelProps {
  recentHistory: ProjectChange[];
  previewChangeId: string | null;
  showAllChanges: boolean;
  loading: boolean;
  onToggleShowAll: () => void;
  onPreviewChange: (change: ProjectChange, preferredDoc?: PreviewDocTarget) => void;
}

export function RecentChangesPanel({
  recentHistory,
  previewChangeId,
  showAllChanges,
  loading,
  onToggleShowAll,
  onPreviewChange,
}: RecentChangesPanelProps) {
  if (recentHistory.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Recent Changes</div>
          <div className="mt-1 text-xs text-muted-foreground">Read-only history for this project.</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">
            {recentHistory.length}
          </span>
          <button
            type="button"
            onClick={onToggleShowAll}
            className="rounded-md bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground"
          >
            {showAllChanges ? 'Hide All' : 'View All'}
          </button>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {recentHistory.map((change) => (
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
              disabled={loading}
              aria-label={`Preview ${change.title}`}
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
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => onPreviewChange(change, 'design')}
                disabled={loading}
                aria-label={`Open ${change.title} design`}
                className="rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Design
              </button>
              <button
                type="button"
                onClick={() => onPreviewChange(change, 'execution')}
                disabled={loading}
                aria-label={`Open ${change.title} execution`}
                className="rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Execution
              </button>
              <button
                type="button"
                onClick={() => onPreviewChange(change, 'tasks')}
                disabled={loading}
                aria-label={`Open ${change.title} tasks`}
                className="rounded-md bg-background px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Tasks
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
