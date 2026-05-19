import { useCallback, useState } from 'react';
import { Copy } from 'lucide-react';
import type { GitWorktree } from '@my-claudia/shared';
import * as api from '../../../services/api';
import { useGitStore } from '../store';
import { SyncButtons } from './SyncButtons';
import { GitStatusView } from './GitStatusView';
import { GitLogView } from './GitLogView';
import { GitBranchesView } from './GitBranchesView';
import { GitStashView } from './GitStashView';

type SubTab = 'status' | 'commits' | 'branches' | 'stash';

interface WorktreeDetailProps {
  projectId: string;
  worktree: GitWorktree;
  onRefreshList?: () => void | Promise<void>;
}

export function WorktreeDetail({ projectId, worktree, onRefreshList }: WorktreeDetailProps) {
  const [tab, setTab] = useState<SubTab>('status');
  const setStatus = useGitStore((s) => s.setStatus);

  const refreshStatus = useCallback(async () => {
    try {
      const next = await api.getWorktreeStatus(projectId, worktree.path);
      setStatus(projectId, worktree.path, next);
    } catch {
      // ignore
    }
  }, [projectId, worktree.path, setStatus]);

  const onAfterSync = useCallback(async () => {
    await refreshStatus();
    if (onRefreshList) await onRefreshList();
  }, [refreshStatus, onRefreshList]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-3 py-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold truncate">{worktree.branch}</span>
              {worktree.isMain && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500">main</span>
              )}
              {worktree.managedBy === 'supervisor' && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500">supervisor</span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-0.5">
              <span className="text-[11px] text-muted-foreground font-mono truncate" title={worktree.path}>
                {worktree.path}
              </span>
              <button
                type="button"
                onClick={() => navigator.clipboard?.writeText(worktree.path).catch(() => {})}
                className="p-0.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                title="Copy path"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
          <SyncButtons projectId={projectId} worktreePath={worktree.path} onAfter={onAfterSync} />
        </div>
      </div>

      {/* Sub-tabs */}
      <div className="border-b border-border px-3 py-2">
        <div className="inline-flex items-center gap-0.5 rounded-lg bg-secondary/60 p-1">
          {(['status', 'commits', 'branches', 'stash'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors ${
                tab === t
                  ? 'bg-background text-foreground shadow-apple-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {tab === 'status' && <GitStatusView projectId={projectId} worktreePath={worktree.path} />}
        {tab === 'commits' && <GitLogView projectId={projectId} worktreePath={worktree.path} />}
        {tab === 'branches' && <GitBranchesView projectId={projectId} worktreePath={worktree.path} />}
        {tab === 'stash' && (
          <GitStashView
            projectId={projectId}
            worktreePath={worktree.path}
            onAfterMutation={refreshStatus}
          />
        )}
      </div>
    </div>
  );
}
