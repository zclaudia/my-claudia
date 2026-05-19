import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CirclePlus,
  Loader2,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { TurnSummary } from '@my-claudia/shared';
import { useSummaryStore } from '../../stores/summaryStore';
import { useToastStore } from '../../stores/toastStore';
import { timeAgo } from '../../utils/timeAgo';
import { CreateIssueDialog } from '../local-issues/components/CreateIssueDialog';
import {
  buildIssueFromSummary,
  hasOpenIssues,
  type TurnStat,
} from '../../components/changes/useSessionChanges';

interface SummarySectionProps {
  sessionId: string;
  /** Owning project of the session — used for the "Create issue" integration.
   *  When absent, the button is hidden. */
  projectId?: string;
  /** The turn this section summarises. Single-turn case only for now. */
  turn: TurnStat | null;
  /** Latest message id in the turn — used to detect summary staleness. */
  latestMessageIdInTurn: string | null;
  relatedFiles?: string[];
  affectedCommands?: string[];
}

export function SummarySection({
  sessionId,
  projectId,
  turn,
  latestMessageIdInTurn,
  relatedFiles = [],
  affectedCommands = [],
}: SummarySectionProps) {
  const entry = useSummaryStore((s) =>
    turn ? s.entries[`${sessionId}:${turn.userMessageId}`] : undefined,
  );
  const hydrate = useSummaryStore((s) => s.hydrateSession);
  const generate = useSummaryStore((s) => s.generate);

  const [issueDialogOpen, setIssueDialogOpen] = useState(false);

  useEffect(() => {
    void hydrate(sessionId);
  }, [sessionId, hydrate]);

  const isStale = useMemo(() => {
    if (!entry?.summary || !latestMessageIdInTurn) return false;
    return entry.summary.asOfMessageId !== latestMessageIdInTurn;
  }, [entry?.summary, latestMessageIdInTurn]);

  // Must be called before the early return below to keep hook call count stable.
  const initialIssue = useMemo(() => {
    if (!entry?.summary || !turn) return null;
    return buildIssueFromSummary({
      openIssues: entry.summary.openIssues,
      goal: entry.summary.goal,
      solved: entry.summary.solved,
      userMessagePreview: turn.userMessagePreview,
      turnTimestamp: turn.timestamp,
      generatedAt: entry.summary.generatedAt,
      stale: isStale,
      relatedFiles,
      affectedCommands,
      stats: turn.stats,
    });
  }, [affectedCommands, entry?.summary, isStale, relatedFiles, turn]);

  const hasContent = !!entry?.summary;
  const isLoading = entry?.status === 'loading';
  const hasError = entry?.status === 'error';

  if (!turn) return null;

  const handleGenerate = (force = false) => {
    void generate(sessionId, turn.userMessageId, { force });
  };

  const showCreateIssue =
    !!entry?.summary && !!projectId && hasOpenIssues(entry.summary.openIssues);

  return (
    <>
      <SectionShell
        hasContent={hasContent}
        isLoading={isLoading}
        isStale={isStale}
        onGenerate={() => handleGenerate(false)}
        onRegenerate={() => handleGenerate(true)}
        summaryTimestamp={entry?.summary?.generatedAt}
      >
        {hasContent && entry?.summary ? (
          <SummaryBody
            summary={entry.summary}
            stale={isStale}
            showCreateIssue={showCreateIssue}
            onCreateIssue={() => setIssueDialogOpen(true)}
          />
        ) : isLoading ? (
          <div className="flex items-center gap-1.5 px-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
            Generating...
          </div>
        ) : hasError ? (
          <div className="px-2 py-2 space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              {entry?.error ?? 'Failed to generate'}
            </div>
            <button
              type="button"
              onClick={() => handleGenerate(false)}
              className="text-[11px] text-primary hover:underline"
            >
              Try again
            </button>
          </div>
        ) : (
          <div className="px-2 py-2 space-y-1.5">
            <p className="text-[11px] text-muted-foreground">
              No summary yet for this turn.
            </p>
            <button
              type="button"
              onClick={() => handleGenerate(false)}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-primary text-primary-foreground hover:opacity-90"
            >
              <Sparkles className="w-3 h-3" />
              Generate summary
            </button>
          </div>
        )}
      </SectionShell>

      {issueDialogOpen && initialIssue && projectId && (
        <CreateIssueDialog
          projectId={projectId}
          initialValues={{
            title: initialIssue.title,
            description: initialIssue.description,
            priority: 'medium',
            labels: ['from-summary'],
          }}
          onClose={() => setIssueDialogOpen(false)}
          onCreated={(issue) => {
            useToastStore.getState().add({
              title: 'Issue created',
              message: issue.title,
              type: 'success',
              projectId,
              sessionId,
            });
          }}
        />
      )}
    </>
  );
}

interface SectionShellProps {
  hasContent: boolean;
  isLoading: boolean;
  isStale: boolean;
  onGenerate: () => void;
  onRegenerate: () => void;
  summaryTimestamp?: number;
  children: React.ReactNode;
}

function SectionShell({
  hasContent,
  isLoading,
  isStale,
  onGenerate,
  onRegenerate,
  summaryTimestamp,
  children,
}: SectionShellProps) {
  const showRegenerate = hasContent && !isLoading;
  return (
    <section className="space-y-1.5">
      <div className="px-1 text-[10px] uppercase tracking-wider font-semibold text-muted-foreground flex items-center gap-1">
        <span>Summary</span>
        {hasContent && summaryTimestamp && (
          <span className="font-normal normal-case tracking-normal text-muted-foreground/70">
            · generated {timeAgo(summaryTimestamp)}
          </span>
        )}
        {isStale && (
          <span className="font-normal normal-case tracking-normal text-amber-600 dark:text-amber-400">
            · stale
          </span>
        )}
        <div className="flex-1" />
        {showRegenerate && (
          <button
            type="button"
            onClick={onRegenerate}
            disabled={isLoading}
            className="p-0.5 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
            title="Regenerate summary"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
        )}
        {!hasContent && !isLoading && (
          <button
            type="button"
            onClick={onGenerate}
            className="p-0.5 rounded hover:bg-secondary text-primary"
            title="Generate summary"
          >
            <Sparkles className="w-3 h-3" />
          </button>
        )}
      </div>
      <div className="border border-border rounded-md bg-card">{children}</div>
    </section>
  );
}

function SummaryBody({
  summary,
  stale,
  showCreateIssue,
  onCreateIssue,
}: {
  summary: TurnSummary;
  stale: boolean;
  showCreateIssue: boolean;
  onCreateIssue: () => void;
}) {
  return (
    <div className={`px-2 py-2 space-y-1.5 text-[11px] ${stale ? 'opacity-70' : ''}`}>
      <SummaryRow label="Goal" body={summary.goal} />
      <SummaryRow label="Solved" body={summary.solved} />
      <SummaryRow
        label="Open"
        body={summary.openIssues}
        trailing={
          showCreateIssue ? (
            <button
              type="button"
              onClick={onCreateIssue}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] bg-secondary hover:bg-secondary/80 text-muted-foreground hover:text-foreground flex-shrink-0"
              title="Create a local issue from this Open item"
            >
              <CirclePlus className="w-3 h-3" />
              Create issue
            </button>
          ) : null
        }
      />
    </div>
  );
}

function SummaryRow({
  label,
  body,
  trailing,
}: {
  label: string;
  body: string;
  trailing?: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="text-muted-foreground w-12 flex-shrink-0 uppercase tracking-wider text-[9px] pt-0.5">
        {label}
      </span>
      <span className="flex-1 min-w-0 whitespace-pre-wrap leading-snug">{body}</span>
      {trailing && <span className="flex-shrink-0">{trailing}</span>}
    </div>
  );
}
