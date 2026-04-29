import type { AcceptanceDecision, ChangeExecutionPlan, ExecutionGateDecision, ProjectChange, SupervisionTask } from '@my-claudia/shared';
import { changeStatusLabel, getNextAction } from './supervisor-utils';

interface ActiveChangeCardProps {
  activeChange: ProjectChange;
  executionPlan: ChangeExecutionPlan | undefined;
  changeTasks: SupervisionTask[];
  actionNotes: string;
  loading: boolean;
  onActionNotesChange: (notes: string) => void;
  onRequestDesign: () => void;
  onResolveDesign: (decision: 'approve_design' | 'revise_design' | 'revise_change') => void;
  onRequestExecution: () => void;
  onResolveExecution: (decision: ExecutionGateDecision) => void;
  onRequestAcceptance: () => void;
  onResolveAcceptance: (decision: AcceptanceDecision) => void;
  onRequestSync: () => void;
  onCompleteChange: () => void;
}

export function ActiveChangeCard({
  activeChange,
  executionPlan,
  changeTasks,
  actionNotes,
  loading,
  onActionNotesChange,
  onRequestDesign,
  onResolveDesign,
  onRequestExecution,
  onResolveExecution,
  onRequestAcceptance,
  onResolveAcceptance,
  onRequestSync,
  onCompleteChange,
}: ActiveChangeCardProps) {
  const canRequestDesign = activeChange.status === 'draft' || activeChange.status === 'designing';
  const canApproveDesign = activeChange.status === 'awaiting_design_review';
  const canRequestExecution = activeChange.status === 'planning';
  const canApproveExecution = activeChange.status === 'awaiting_execution_review';
  const canRequestAcceptance = activeChange.status === 'executing';
  const canApproveAcceptance = activeChange.status === 'accepting';
  const canRequestSync = false;
  const canCompleteChange = activeChange.status === 'syncing';
  const showActionNotes = canRequestDesign
    || canApproveDesign
    || canRequestExecution
    || canApproveExecution
    || canRequestAcceptance
    || canApproveAcceptance
    || canRequestSync
    || canCompleteChange;
  const nextAction = getNextAction(activeChange.status);

  return (
    <div className="rounded-lg border border-border bg-card px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">Active Change</div>
          <div className="mt-1 text-sm font-semibold">{activeChange.title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{activeChange.summary}</div>
        </div>
        <span className="rounded-full bg-secondary px-2 py-1 text-[10px] font-medium text-muted-foreground">
          {changeStatusLabel[activeChange.status] ?? activeChange.status}
        </span>
      </div>

      {executionPlan && (
        <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-muted-foreground">
          <div>Strategy: <span className="text-foreground">{executionPlan.automation.strategy}</span></div>
          <div>Tasks: <span className="text-foreground">{changeTasks.length}</span></div>
        </div>
      )}

      {nextAction && (
        <div className="mt-3 rounded border border-border bg-secondary/20 px-3 py-2">
          <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            Next Action
          </div>
          <div className="mt-1 text-xs text-foreground">{nextAction.title}</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{nextAction.description}</div>
        </div>
      )}

      {showActionNotes && (
        <div className="mt-3 space-y-1">
          <label htmlFor="supervisor-action-notes" className="text-[11px] font-medium text-muted-foreground">
            Review / Sync Notes
          </label>
          <textarea
            id="supervisor-action-notes"
            value={actionNotes}
            onChange={(event) => onActionNotesChange(event.target.value)}
            placeholder="Optional notes for the next gate or sync action..."
            rows={2}
            className="w-full rounded border border-border bg-background px-3 py-2 text-xs resize-none"
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={onRequestDesign}
          disabled={loading || !canRequestDesign}
          className="px-2.5 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
        >
          Request Design Review
        </button>
        <button
          onClick={() => onResolveDesign('approve_design')}
          disabled={loading || !canApproveDesign}
          className="px-2.5 py-1.5 text-xs rounded bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          Approve Design
        </button>
        <button
          onClick={onRequestExecution}
          disabled={loading || !canRequestExecution}
          className="px-2.5 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
        >
          Request Execution Review
        </button>
        <button
          onClick={() => onResolveExecution('approve_execution')}
          disabled={loading || !canApproveExecution}
          className="px-2.5 py-1.5 text-xs rounded bg-blue-500/15 text-blue-600 hover:bg-blue-500/25 disabled:opacity-50"
        >
          Start Execution
        </button>
        <button
          onClick={onRequestAcceptance}
          disabled={loading || !canRequestAcceptance}
          className="px-2.5 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
        >
          Request Acceptance
        </button>
        <button
          onClick={() => onResolveAcceptance('approve_acceptance')}
          disabled={loading || !canApproveAcceptance}
          className="px-2.5 py-1.5 text-xs rounded bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          Approve Acceptance
        </button>
        <button
          onClick={() => onResolveAcceptance('revise_execution')}
          disabled={loading || !canApproveAcceptance}
          className="px-2.5 py-1.5 text-xs rounded bg-amber-500/15 text-amber-700 hover:bg-amber-500/25 disabled:opacity-50"
        >
          Reopen Execution
        </button>
        <button
          onClick={onRequestSync}
          disabled={loading || !canRequestSync}
          className="hidden px-2.5 py-1.5 text-xs rounded bg-secondary hover:bg-secondary/80 disabled:opacity-50"
        >
          Request Sync
        </button>
        <button
          onClick={onCompleteChange}
          disabled={loading || !canCompleteChange}
          className="px-2.5 py-1.5 text-xs rounded bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/25 disabled:opacity-50"
        >
          Complete Change
        </button>
      </div>
    </div>
  );
}
