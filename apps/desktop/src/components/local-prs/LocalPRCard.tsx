import type { LocalPR, LocalPRStatus, ProviderConfig } from '@my-claudia/shared';
import { GitMerge, XCircle, ChevronDown, ChevronUp, Eye, MessageSquare, FileCode } from 'lucide-react';
import { useState } from 'react';
import { useLocalPRStore } from '../../stores/localPRStore';
import { useProjectStore } from '../../stores/projectStore';
import * as api from '../../services/api';
import { DiffViewerModal } from './DiffViewerModal';

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
  const [diffOpen, setDiffOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [reviewPickerOpen, setReviewPickerOpen] = useState(false);
  const { closePR, reviewPR, mergePR } = useLocalPRStore();
  const providers = useProjectStore((s) => s.providers);
  const projects = useProjectStore((s) => s.projects);
  const sessions = useProjectStore((s) => s.sessions);
  const selectSession = useProjectStore((s) => s.selectSession);
  const status = STATUS_CONFIG[pr.status] ?? { label: pr.status, color: 'bg-gray-500/10 text-gray-400' };

  const project = projects.find((p) => p.id === projectId);
  const defaultProviderId = project?.reviewProviderId || project?.providerId || '';

  const branchShort = pr.branchName.replace(/^(feat|fix|chore|refactor)\//, '');
  const commitCount = pr.commits?.length ?? 0;
  const date = new Date(pr.createdAt).toLocaleDateString();

  const handleClose = async () => {
    setLoading(true);
    try { await closePR(pr.id, projectId); } finally { setLoading(false); }
  };

  const handleMerge = async () => {
    setLoading(true);
    try { await mergePR(pr.id, projectId); } finally { setLoading(false); }
  };

  const handleReview = async (providerId?: string) => {
    setReviewPickerOpen(false);
    setLoading(true);
    try { await reviewPR(pr.id, projectId, providerId || undefined); } finally { setLoading(false); }
  };

  const canReview = pr.status === 'open' || pr.status === 'review_failed';

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
            {pr.autoReview && (
              <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">auto-review</span>
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
          {canReview && (
            <div className="relative">
              <button
                onClick={() => setReviewPickerOpen((v) => !v)}
                disabled={loading}
                title="AI Review"
                className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <Eye className="w-3.5 h-3.5" />
              </button>
              {reviewPickerOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setReviewPickerOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 bg-popover border border-border rounded-lg shadow-lg p-2 min-w-[200px]">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5 px-1">Review with:</p>
                    <button
                      onClick={() => handleReview(defaultProviderId)}
                      className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
                    >
                      Default{defaultProviderId ? ` (${getProviderLabel(providers, defaultProviderId)})` : ''}
                    </button>
                    {providers.filter((p) => p.id !== defaultProviderId).map((p) => (
                      <button
                        key={p.id}
                        onClick={() => handleReview(p.id)}
                        className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted"
                      >
                        {p.name} ({p.type})
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {pr.status === 'open' && (
            <button
              onClick={handleMerge}
              disabled={loading}
              title="Merge directly (skip review)"
              className="p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              <GitMerge className="w-3.5 h-3.5" />
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

      <div className="flex items-center gap-3 flex-wrap">
        {pr.diffSummary && (
          <button
            onClick={() => setDiffOpen(true)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <FileCode className="w-3 h-3" />
            View diff
          </button>
        )}
        {pr.reviewSessionId && (
          <button
            onClick={async () => {
              const sid = pr.reviewSessionId!;
              // If session isn't in store yet (broadcast missed), refresh from server
              if (!sessions.find((s) => s.id === sid)) {
                const fresh = await api.getSessions(projectId);
                useProjectStore.getState().mergeSessions(fresh);
              }
              // Session may have been permanently deleted
              if (!useProjectStore.getState().sessions.find((s) => s.id === sid)) return;
              selectSession(sid);
            }}
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80"
          >
            <MessageSquare className="w-3 h-3" />
            View review session
          </button>
        )}
        {pr.reviewNotes && (
          <button
            onClick={() => setNotesOpen((v) => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {notesOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            Review notes
          </button>
        )}
      </div>

      {diffOpen && pr.diffSummary && (
        <DiffViewerModal
          title={pr.title}
          diff={pr.diffSummary}
          onClose={() => setDiffOpen(false)}
        />
      )}

      {notesOpen && pr.reviewNotes && (
        <pre className="text-xs bg-muted p-2 rounded overflow-auto max-h-40 whitespace-pre-wrap">
          {pr.reviewNotes}
        </pre>
      )}
    </div>
  );
}

function getProviderLabel(providers: ProviderConfig[], id: string): string {
  const p = providers.find((p) => p.id === id);
  return p ? `${p.name}` : id.slice(0, 8);
}
