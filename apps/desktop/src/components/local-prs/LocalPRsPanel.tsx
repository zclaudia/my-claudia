import { useEffect, useState } from 'react';
import type { LocalPRStatus } from '@my-claudia/shared';
import { GitPullRequest, Plus } from 'lucide-react';
import { useLocalPRStore } from '../../stores/localPRStore';
import { LocalPRCard } from './LocalPRCard';
import { CreateLocalPRDialog } from './CreateLocalPRDialog';

const STATUS_ORDER: LocalPRStatus[] = [
  'conflict',
  'review_failed',
  'open',
  'reviewing',
  'merging',
  'approved',
  'merged',
  'closed',
];

const GROUP_LABELS: Partial<Record<LocalPRStatus, string>> = {
  open: 'Open',
  reviewing: 'Reviewing',
  review_failed: 'Review Failed',
  approved: 'Approved — Ready to Merge',
  merging: 'Merging',
  conflict: 'Conflict',
  merged: 'Merged',
  closed: 'Closed',
};

interface LocalPRsPanelProps {
  projectId: string;
  projectRootPath?: string;
}

export function LocalPRsPanel({ projectId, projectRootPath }: LocalPRsPanelProps) {
  const { prs, loadPRs } = useLocalPRStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    loadPRs(projectId).finally(() => setLoading(false));
  }, [projectId]);

  const projectPRs = prs[projectId] ?? [];

  // Group by status
  const grouped = STATUS_ORDER.reduce<Partial<Record<LocalPRStatus, typeof projectPRs>>>(
    (acc, status) => {
      const items = projectPRs.filter((pr) => pr.status === status);
      if (items.length > 0) acc[status] = items;
      return acc;
    },
    {},
  );

  const activePRs = projectPRs.filter(
    (pr) => !['merged', 'closed'].includes(pr.status),
  ).length;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <GitPullRequest className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Local PRs</span>
          {activePRs > 0 && (
            <span className="text-xs bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
              {activePRs}
            </span>
          )}
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md bg-primary/10 text-primary hover:bg-primary/20"
        >
          <Plus className="w-3.5 h-3.5" />
          New PR
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {loading && (
          <p className="text-xs text-muted-foreground text-center py-4">Loading…</p>
        )}

        {!loading && projectPRs.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <GitPullRequest className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No local PRs yet</p>
            <p className="text-xs mt-1">
              When a worktree feature is done, create a PR to trigger AI review and auto-merge.
            </p>
          </div>
        )}

        {(Object.entries(grouped) as [LocalPRStatus, typeof projectPRs][]).map(([status, items]) => (
          <div key={status}>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              {GROUP_LABELS[status] ?? status}
            </h3>
            <div className="space-y-2">
              {items.map((pr) => (
                <LocalPRCard key={pr.id} pr={pr} projectId={projectId} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {createOpen && (
        <CreateLocalPRDialog
          projectId={projectId}
          projectRootPath={projectRootPath}
          onClose={() => setCreateOpen(false)}
        />
      )}
    </div>
  );
}
