import type { LocalPR, LocalPRStatus } from '@my-claudia/shared';
import { GitMerge, RefreshCw, XCircle, ChevronDown, ChevronUp } from 'lucide-react';
import { useState } from 'react';
import { useLocalPRStore } from '../../stores/localPRStore';

const STATUS_CONFIG: Record<LocalPRStatus, { label: string; color: string }> = {
  open: { label: 'Open', color: 'bg-blue-500/10 text-blue-500' },
  reviewing: { label: 'Reviewing', color: 'bg-yellow-500/10 text-yellow-500' },
  review_failed: { label: 'Review Failed', color: 'bg-red-500/10 text-red-500' },
  approved: { label: 'Approved', color: 'bg-green-500/10 text-green-600' },
  merging: { label: 'Merging', color: 'bg-cyan-500/10 text-cyan-500' },
  merged: { label: 'Merged', color: 'bg-emerald-600/10 text-emerald-600' },
  conflict: { label: 'Conflict', color: 'bg-orange-500/10 text-orange-500' },
  closed: { label: 'Closed', color: 'bg-gray-500/10 text-gray-400' },
};

interface LocalPRCardProps {
  pr: LocalPR;
  projectId: string;
}

export function LocalPRCard({ pr, projectId }: LocalPRCardProps) {
  const [notesOpen, setNotesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const { closePR, retryReview, mergePR } = useLocalPRStore();
  const status = STATUS_CONFIG[pr.status] ?? { label: pr.status, color: 'bg-gray-500/10 text-gray-400' };

  const branchShort = pr.branchName.replace(/^(feat|fix|chore|refactor)\//, '');
  const commitCount = pr.commits?.length ?? 0;
  const date = new Date(pr.createdAt).toLocaleDateString();

  const handleClose = async () => {
    if (!confirm('Close this local PR?')) return;
    setLoading(true);
    try { await closePR(pr.id, projectId); } finally { setLoading(false); }
  };

  const handleRetry = async () => {
    setLoading(true);
    try { await retryReview(pr.id, projectId); } finally { setLoading(false); }
  };

  const handleMerge = async () => {
    if (!confirm(`Merge "${pr.branchName}" into "${pr.baseBranch}"?`)) return;
    setLoading(true);
    try { await mergePR(pr.id, projectId); } finally { setLoading(false); }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status.color}`}>
              {status.label}
            </span>
            {pr.autoTriggered && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">auto</span>
            )}
          </div>
          <p className="text-sm font-medium mt-1 truncate" title={pr.title}>{pr.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            <code className="bg-muted px-1 rounded">{branchShort}</code>
            {' → '}
            <code className="bg-muted px-1 rounded">{pr.baseBranch}</code>
            {' · '}
            {commitCount} commit{commitCount !== 1 ? 's' : ''}
            {' · '}
            {date}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {pr.status === 'review_failed' && (
            <button
              onClick={handleRetry}
              disabled={loading}
              title="Retry review"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          )}
          {(pr.status === 'approved' || pr.status === 'conflict') && (
            <button
              onClick={handleMerge}
              disabled={loading}
              title="Merge now"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <GitMerge className="w-3.5 h-3.5" />
            </button>
          )}
          {!['merged', 'closed'].includes(pr.status) && (
            <button
              onClick={handleClose}
              disabled={loading}
              title="Close PR"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-red-400 disabled:opacity-50"
            >
              <XCircle className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {pr.reviewNotes && (
        <div>
          <button
            onClick={() => setNotesOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {notesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Review notes
          </button>
          {notesOpen && (
            <pre className="mt-1 text-xs bg-muted p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">
              {pr.reviewNotes}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
