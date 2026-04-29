import { ClipboardList } from 'lucide-react';

interface TaskPlanStatus {
  exists: boolean;
  ready: boolean;
  score?: number;
  missing: string[];
}

interface PlanStatusBarProps {
  taskPlanStatus: TaskPlanStatus | null;
  planStatusLoading: boolean;
  submitPlanLoading: boolean;
  discardPlanLoading: boolean;
  isLoading: boolean;
  onRestorePlan: () => void;
  onDiscardPlan: () => void;
  onSubmitPlan: () => void;
}

export function PlanStatusBar({
  taskPlanStatus,
  planStatusLoading,
  submitPlanLoading,
  discardPlanLoading,
  isLoading,
  onRestorePlan,
  onDiscardPlan,
  onSubmitPlan,
}: PlanStatusBarProps) {
  return (
    <div className="px-2 md:px-4 pt-2 md:pt-3">
      <div className="px-3 py-2 bg-blue-500/10 border border-blue-500/20 rounded-lg flex items-center gap-3 text-sm text-blue-500">
        <ClipboardList size={14} className="flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="font-medium">Planning mode — iterate with Start/Continue Plan.</div>
          <div className="text-xs text-blue-500/90 mt-0.5">
            {planStatusLoading
              ? 'Checking plan document status...'
              : taskPlanStatus?.ready
                ? `Plan ready to submit (score ${taskPlanStatus.score}).`
                : taskPlanStatus?.exists
                  ? `Plan not ready: missing ${taskPlanStatus.missing.join(', ')}`
                  : 'No plan document found yet. Create .supervision/plans/task-<taskId>.plan.md'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {taskPlanStatus?.exists && !isLoading && (
            <button
              onClick={onRestorePlan}
              className="px-3 py-1.5 rounded-md text-xs border border-blue-500/40 text-blue-500 hover:bg-blue-500/10 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Restore Plan
            </button>
          )}
          <button
            onClick={onDiscardPlan}
            disabled={discardPlanLoading || submitPlanLoading || isLoading}
            className="px-3 py-1.5 rounded-md text-xs border border-destructive/40 text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {discardPlanLoading ? 'Discarding...' : 'Discard Plan'}
          </button>
          <button
            onClick={onSubmitPlan}
            disabled={!taskPlanStatus?.ready || submitPlanLoading || discardPlanLoading || isLoading}
            className="px-3 py-1.5 rounded-md text-xs bg-primary text-primary-foreground disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed"
          >
            {submitPlanLoading ? 'Submitting...' : 'Submit Plan'}
          </button>
        </div>
      </div>
    </div>
  );
}
