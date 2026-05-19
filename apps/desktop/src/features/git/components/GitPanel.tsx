import { useCallback, useEffect, useState } from 'react';
import * as api from '../../../services/api';
import { useGitStore } from '../store';
import { WorktreeList } from './WorktreeList';
import { WorktreeDetail } from './WorktreeDetail';

interface GitPanelProps {
  projectId: string;
  projectRootPath?: string;
}

export function GitPanel({ projectId, projectRootPath }: GitPanelProps) {
  const worktrees = useGitStore((s) => s.worktrees[projectId] ?? []);
  const selectedPath = useGitStore((s) => s.selectedWorktree[projectId] ?? null);
  const setWorktrees = useGitStore((s) => s.setWorktrees);
  const setSelectedWorktree = useGitStore((s) => s.setSelectedWorktree);
  const setStatus = useGitStore((s) => s.setStatus);
  const [loading, setLoading] = useState(false);

  const refreshWorktrees = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.getProjectWorktrees(projectId);
      setWorktrees(projectId, list);
      // Lazy-load status for each in parallel (best effort).
      await Promise.all(
        list.map(async (wt) => {
          try {
            const status = await api.getWorktreeStatus(projectId, wt.path);
            setStatus(projectId, wt.path, status);
          } catch {
            // ignore individual failures
          }
        }),
      );
      // Default-select first non-supervisor worktree if nothing selected
      if (!selectedPath) {
        const preferred = list.find((w) => !w.managedBy) ?? list[0];
        if (preferred) setSelectedWorktree(projectId, preferred.path);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, selectedPath, setWorktrees, setSelectedWorktree, setStatus]);

  useEffect(() => {
    refreshWorktrees().catch(() => {});
  }, [projectId]);

  const selected = worktrees.find((w) => w.path === selectedPath) ?? null;
  const hasRoot = !!projectRootPath;

  if (!hasRoot) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-muted-foreground">
        <div>
          <p className="text-sm">This project has no local path.</p>
          <p className="text-xs mt-1">Git management is only available for projects with a `rootPath`.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-72 flex-shrink-0 border-r border-border overflow-y-auto">
        <WorktreeList
          projectId={projectId}
          worktrees={worktrees}
          selectedPath={selectedPath}
          loading={loading}
          onSelect={(p) => setSelectedWorktree(projectId, p)}
          onRefresh={refreshWorktrees}
        />
      </div>
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <WorktreeDetail
            projectId={projectId}
            worktree={selected}
            onRefreshList={refreshWorktrees}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Select a worktree to inspect it.
          </div>
        )}
      </div>
    </div>
  );
}
