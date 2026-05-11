import { AlertTriangle, CircleCheck, HelpCircle, Loader2 } from 'lucide-react';
import { timeAgo } from '../../utils/timeAgo';
import type { TurnStat, TurnStats } from './useSessionChanges';

interface TurnSummaryCardProps {
  turn: TurnStat;
}

interface StatChip {
  label: string;
  value: number;
}

function doneChips(s: TurnStats): StatChip[] {
  const out: StatChip[] = [];
  if (s.fileCount > 0) out.push({ label: `${s.fileCount} ${s.fileCount === 1 ? 'file' : 'files'}`, value: s.fileCount });
  if (s.editCount > 0) out.push({ label: `${s.editCount} ${s.editCount === 1 ? 'edit' : 'edits'}`, value: s.editCount });
  if (s.writeCount > 0) out.push({ label: `${s.writeCount} ${s.writeCount === 1 ? 'write' : 'writes'}`, value: s.writeCount });
  if (s.notebookEditCount > 0) out.push({ label: `${s.notebookEditCount} notebook edit${s.notebookEditCount === 1 ? '' : 's'}`, value: s.notebookEditCount });
  if (s.destructiveBashCount > 0) {
    out.push({ label: `${s.destructiveBashCount} destructive bash`, value: s.destructiveBashCount });
  } else if (s.bashCount > 0) {
    out.push({ label: `${s.bashCount} bash`, value: s.bashCount });
  }
  return out;
}

export function TurnSummaryCard({ turn }: TurnSummaryCardProps) {
  const s = turn.stats;
  const done = doneChips(s);
  const hasFailures = s.failureCount > 0;
  const hasPending = s.pendingQuestionCount > 0;
  const inProgress = s.runningToolCount > 0;
  const allClean = !hasFailures && !hasPending && !inProgress && done.length > 0;
  const idle = done.length === 0 && !hasFailures && !hasPending && !inProgress;

  return (
    <div className="border border-border rounded-md bg-card overflow-hidden">
      <div className="px-2 py-1.5 border-b border-border/70 flex items-baseline gap-2 min-w-0">
        <span className="text-xs font-medium truncate flex-1 min-w-0" title={turn.userMessagePreview}>
          {turn.userMessagePreview || '(empty user message)'}
        </span>
        <span className="text-[10px] text-muted-foreground flex-shrink-0">
          {timeAgo(turn.timestamp)}
        </span>
      </div>
      <div className="px-2 py-1.5 space-y-1 text-[11px]">
        <div className="flex items-start gap-1.5">
          <span className="text-muted-foreground w-10 flex-shrink-0">Done</span>
          {done.length === 0 ? (
            <span className="text-muted-foreground italic">nothing yet</span>
          ) : (
            <span className="flex flex-wrap gap-1 min-w-0">
              {done.map((chip) => (
                <span key={chip.label} className="px-1.5 py-0.5 rounded bg-secondary/70 text-foreground">
                  {chip.label}
                </span>
              ))}
            </span>
          )}
        </div>
        <div className="flex items-start gap-1.5">
          <span className="text-muted-foreground w-10 flex-shrink-0">Open</span>
          <span className="flex flex-wrap gap-1 min-w-0 items-center">
            {hasFailures && (
              <span className="px-1.5 py-0.5 rounded bg-red-500/15 text-red-700 dark:text-red-300 inline-flex items-center gap-0.5">
                <AlertTriangle className="w-3 h-3" />
                {s.failureCount} failed
              </span>
            )}
            {hasPending && (
              <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 inline-flex items-center gap-0.5">
                <HelpCircle className="w-3 h-3" />
                {s.pendingQuestionCount} pending question{s.pendingQuestionCount === 1 ? '' : 's'}
              </span>
            )}
            {inProgress && (
              <span className="px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-700 dark:text-blue-300 inline-flex items-center gap-0.5">
                <Loader2 className="w-3 h-3 animate-spin" />
                {s.runningToolCount} running
              </span>
            )}
            {allClean && (
              <span className="text-muted-foreground inline-flex items-center gap-0.5">
                <CircleCheck className="w-3 h-3 text-green-600 dark:text-green-400" />
                all completed
              </span>
            )}
            {idle && (
              <span className="text-muted-foreground italic">no activity</span>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}
