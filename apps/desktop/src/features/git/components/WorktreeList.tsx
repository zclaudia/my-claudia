import { useState } from 'react';
import { GitBranch as BranchIcon, Plus, RefreshCw, Shield, Trash2 } from 'lucide-react';
import type { GitWorktree } from '@my-claudia/shared';
import * as api from '../../../services/api';
import { useGitStore, selectStatus } from '../store';
import { runWithToast } from '../runWithToast';

interface WorktreeListProps {
  projectId: string;
  worktrees: GitWorktree[];
  selectedPath: string | null;
  loading: boolean;
  onSelect: (path: string) => void;
  onRefresh: () => Promise<void> | void;
}

export function WorktreeList({
  projectId,
  worktrees,
  selectedPath,
  loading,
  onSelect,
  onRefresh,
}: WorktreeListProps) {
  const [creating, setCreating] = useState(false);
  const [newBranch, setNewBranch] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const removeWorktreeFromCache = useGitStore((s) => s.removeWorktreeFromCache);

  const handleCreate = async () => {
    const branch = newBranch.trim();
    if (!branch || submitting) return;
    setSubmitting(true);
    const result = await runWithToast(`Create worktree '${branch}'`, projectId, () =>
      api.createProjectWorktree(projectId, branch),
    );
    setSubmitting(false);
    if (result) {
      setNewBranch('');
      setCreating(false);
      await onRefresh();
    }
  };

  const handleDelete = async (wt: GitWorktree) => {
    if (wt.managedBy === 'supervisor') return;
    if (wt.isMain) return;
    const confirmed = window.confirm(
      `Remove worktree at "${wt.path}"? This deletes the directory and the local branch "${wt.branch}".`,
    );
    if (!confirmed) return;
    const result = await runWithToast(`Remove worktree '${wt.branch}'`, projectId, () =>
      api.deleteProjectWorktree(projectId, wt.path),
    );
    if (result !== null) {
      removeWorktreeFromCache(projectId, wt.path);
      await onRefresh();
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Worktrees ({worktrees.length})
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onRefresh()}
            disabled={loading}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => setCreating((v) => !v)}
            className="p-1 rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-colors"
            title="New worktree"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {creating && (
        <div className="px-3 py-2 border-b border-border bg-card/50 space-y-2">
          <input
            type="text"
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleCreate();
              } else if (e.key === 'Escape') {
                setCreating(false);
                setNewBranch('');
              }
            }}
            placeholder="branch name (e.g. feat/x)"
            className="w-full text-xs px-2 py-1.5 rounded bg-background border border-border focus:border-primary outline-none"
            autoFocus
          />
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleCreate}
              disabled={submitting || !newBranch.trim()}
              className="flex-1 text-xs py-1 rounded bg-primary text-primary-foreground disabled:opacity-50 hover:opacity-90"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewBranch('');
              }}
              className="text-xs px-2 py-1 rounded bg-secondary text-muted-foreground hover:text-foreground"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-y-auto divide-y divide-border">
        {worktrees.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-muted-foreground">
            {loading ? 'Loading…' : 'No worktrees.'}
          </div>
        ) : (
          worktrees.map((wt) => (
            <WorktreeRow
              key={wt.path}
              projectId={projectId}
              worktree={wt}
              selected={wt.path === selectedPath}
              onSelect={() => onSelect(wt.path)}
              onDelete={() => handleDelete(wt)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function WorktreeRow({
  projectId,
  worktree,
  selected,
  onSelect,
  onDelete,
}: {
  projectId: string;
  worktree: GitWorktree;
  selected: boolean;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const status = useGitStore(selectStatus(projectId, worktree.path));
  const dirty = status && !status.clean;
  const isManaged = worktree.managedBy === 'supervisor';
  const canDelete = !worktree.isMain && !isManaged;

  return (
    <div
      onClick={onSelect}
      className={`group flex items-start gap-2 px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors ${
        selected ? 'bg-accent' : ''
      }`}
    >
      <BranchIcon className="w-3.5 h-3.5 mt-0.5 text-muted-foreground flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium truncate">{worktree.branch}</span>
          {worktree.isMain && (
            <span className="text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-500 flex-shrink-0">
              main
            </span>
          )}
          {isManaged && (
            <span
              className="text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-500 flex-shrink-0 flex items-center gap-0.5"
              title="Managed by Supervisor v2 worktree pool — cannot be deleted manually"
            >
              <Shield className="w-2.5 h-2.5" />
              supervisor
            </span>
          )}
        </div>
        <div className="text-[10px] text-muted-foreground truncate font-mono mt-0.5" title={worktree.path}>
          {worktree.path}
        </div>
        {status && (
          <div className="flex items-center gap-2 mt-1 text-[10px]">
            <span className={dirty ? 'text-orange-500' : 'text-green-500'}>
              {dirty ? 'dirty' : 'clean'}
            </span>
            {status.ahead > 0 && <span className="text-muted-foreground">↑{status.ahead}</span>}
            {status.behind > 0 && <span className="text-muted-foreground">↓{status.behind}</span>}
          </div>
        )}
      </div>
      {canDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 flex-shrink-0"
          title="Remove worktree"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}
