import { useEffect, useState, useCallback } from 'react';
import type { LocalPRStatus, GitWorktree, WorktreeConfig } from '@my-claudia/shared';
import { GitBranch, GitPullRequest, Loader2, Plus } from 'lucide-react';
import { useLocalPRStore } from '../../stores/localPRStore';
import { getProjectWorktrees, getWorktreeConfigs, upsertWorktreeConfig } from '../../services/api';
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
  const { prs, loadPRs, createPR } = useLocalPRStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [worktrees, setWorktrees] = useState<GitWorktree[]>([]);
  const [wtConfigs, setWtConfigs] = useState<Record<string, WorktreeConfig>>({});
  const [creatingPath, setCreatingPath] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      loadPRs(projectId),
      getProjectWorktrees(projectId).then(setWorktrees).catch(() => {}),
      getWorktreeConfigs(projectId).then((configs) => {
        const map: Record<string, WorktreeConfig> = {};
        for (const c of configs) map[c.worktreePath] = c;
        setWtConfigs(map);
      }).catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [projectId]);

  const projectPRs = prs[projectId] ?? [];

  // Worktrees that don't have an active PR
  const activePRPaths = new Set(
    projectPRs
      .filter((pr) => !['merged', 'closed'].includes(pr.status))
      .map((pr) => pr.worktreePath),
  );
  const allNonMainWorktrees = worktrees.filter((wt) => !wt.isMain);

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

  const handleQuickCreate = async (worktreePath: string) => {
    setCreatingPath(worktreePath);
    try {
      const config = wtConfigs[worktreePath];
      await createPR(projectId, worktreePath, {
        autoReview: config?.autoReview || undefined,
      });
    } catch (err) {
      console.error('Failed to create PR:', err);
    } finally {
      setCreatingPath(null);
    }
  };

  const handleToggleConfig = useCallback(async (
    worktreePath: string,
    field: 'autoCreatePR' | 'autoReview',
    value: boolean,
  ) => {
    const current = wtConfigs[worktreePath] ?? {
      projectId,
      worktreePath,
      autoCreatePR: false,
      autoReview: false,
    };
    const updated = { ...current, [field]: value };
    setWtConfigs((prev) => ({ ...prev, [worktreePath]: updated }));
    try {
      await upsertWorktreeConfig(projectId, {
        worktreePath,
        autoCreatePR: updated.autoCreatePR,
        autoReview: updated.autoReview,
      });
    } catch (err) {
      console.error('Failed to update worktree config:', err);
      // Revert on error
      setWtConfigs((prev) => ({ ...prev, [worktreePath]: current }));
    }
  }, [projectId, wtConfigs]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <GitPullRequest className="w-4 h-4 text-muted-foreground" />
          <span className="text-sm font-medium">Local Pull Requests</span>
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

        {/* Worktree Configs */}
        {!loading && allNonMainWorktrees.length > 0 && (
          <div>
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Worktrees
            </h3>
            <div className="space-y-1.5">
              {allNonMainWorktrees.map((wt) => {
                const config = wtConfigs[wt.path];
                const hasActivePR = activePRPaths.has(wt.path);
                return (
                  <div
                    key={wt.path}
                    className="px-3 py-2 bg-muted/50 border border-border rounded-lg space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <GitBranch className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium truncate">{wt.branch}</span>
                      </div>
                      {!hasActivePR && (
                        <button
                          onClick={() => handleQuickCreate(wt.path)}
                          disabled={creatingPath !== null}
                          className="shrink-0 flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-50"
                        >
                          {creatingPath === wt.path ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <Plus className="w-3 h-3" />
                          )}
                          Create PR
                        </button>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config?.autoCreatePR ?? false}
                          onChange={(e) => handleToggleConfig(wt.path, 'autoCreatePR', e.target.checked)}
                          className="rounded border-border w-3 h-3"
                        />
                        <span className="text-[11px] text-muted-foreground">Auto Create PR</span>
                      </label>
                      <label className="flex items-center gap-1.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={config?.autoReview ?? false}
                          onChange={(e) => handleToggleConfig(wt.path, 'autoReview', e.target.checked)}
                          className="rounded border-border w-3 h-3"
                        />
                        <span className="text-[11px] text-muted-foreground">Auto Review</span>
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {!loading && projectPRs.length === 0 && allNonMainWorktrees.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            <GitPullRequest className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No local pull requests yet</p>
            <p className="text-xs mt-1">
              When a worktree feature is done, create a pull request to trigger AI review and auto-merge.
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
