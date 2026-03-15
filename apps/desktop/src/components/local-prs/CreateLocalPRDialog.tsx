import { useEffect, useState } from 'react';
import type { GitWorktree } from '@my-claudia/shared';
import { X } from 'lucide-react';
import { useLocalPRStore } from '../../stores/localPRStore';
import { getProjectWorktrees, listLocalPRs } from '../../services/api';
import { useAndroidBack } from '../../hooks/useAndroidBack';

interface CreateLocalPRDialogProps {
  projectId: string;
  projectRootPath?: string;
  onClose: () => void;
  /** Pre-fill worktree path (e.g. from sidebar "Submit PR" button) */
  defaultWorktreePath?: string;
}

export function CreateLocalPRDialog({
  projectId,
  onClose,
  defaultWorktreePath = '',
}: CreateLocalPRDialogProps) {
  useAndroidBack(onClose, true, 25);
  const { createPR } = useLocalPRStore();
  const [worktreePath, setWorktreePath] = useState(defaultWorktreePath);
  const [baseBranch, setBaseBranch] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [autoReview, setAutoReview] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [availableWorktrees, setAvailableWorktrees] = useState<GitWorktree[]>([]);
  const [allWorktrees, setAllWorktrees] = useState<GitWorktree[]>([]);
  const [loadingWorktrees, setLoadingWorktrees] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [worktrees, prs] = await Promise.all([
          getProjectWorktrees(projectId),
          listLocalPRs(projectId),
        ]);
        setAllWorktrees(worktrees);
        const activePRPaths = new Set(
          prs
            .filter((pr) => !['merged', 'closed'].includes(pr.status))
            .map((pr) => pr.worktreePath),
        );
        const available = worktrees.filter(
          (wt) => !wt.isMain && !activePRPaths.has(wt.path),
        );
        setAvailableWorktrees(available);
        // Auto-select if only one available or default matches
        if (defaultWorktreePath) {
          setWorktreePath(defaultWorktreePath);
        } else if (available.length === 1) {
          setWorktreePath(available[0].path);
        }
      } catch {
        // If worktree API fails, user can still type manually
      } finally {
        setLoadingWorktrees(false);
      }
    })();
  }, [projectId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!worktreePath.trim()) {
      setError('Worktree path is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await createPR(projectId, worktreePath.trim(), {
        title: title.trim() || undefined,
        description: description.trim() || undefined,
        baseBranch: baseBranch || undefined,
        autoReview: autoReview || undefined,
      });
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-[calc(100vw-2rem)] md:max-w-md p-3 md:p-5 overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Create Local PR</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Worktree <span className="text-red-500">*</span>
            </label>
            {loadingWorktrees ? (
              <div className="w-full text-sm bg-muted border border-border rounded-md px-3 py-2 text-muted-foreground">
                Loading worktrees…
              </div>
            ) : availableWorktrees.length > 0 ? (
              <select
                value={worktreePath}
                onChange={(e) => setWorktreePath(e.target.value)}
                className="w-full text-sm text-base bg-muted border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
              >
                <option value="">Select a worktree…</option>
                {availableWorktrees.map((wt) => (
                  <option key={wt.path} value={wt.path}>
                    {wt.branch} ({wt.path})
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                value={worktreePath}
                onChange={(e) => setWorktreePath(e.target.value)}
                placeholder="/path/to/worktree"
                className="w-full text-sm text-base bg-muted border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
              />
            )}
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Target Branch <span className="text-muted-foreground">(defaults to main branch)</span>
            </label>
            <select
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              className="w-full text-sm text-base bg-muted border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Auto-detect (main/master)</option>
              {allWorktrees
                .filter((wt) => wt.path !== worktreePath)
                .map((wt) => (
                  <option key={wt.path} value={wt.branch}>
                    {wt.branch}{wt.isMain ? ' (main worktree)' : ''}
                  </option>
                ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Title <span className="text-muted-foreground">(optional — defaults to branch/commit)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Brief description of the feature"
              className="w-full text-sm text-base bg-muted border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Description <span className="text-muted-foreground">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Additional context for the reviewer"
              rows={3}
              className="w-full text-sm text-base bg-muted border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={autoReview}
              onChange={(e) => setAutoReview(e.target.checked)}
              className="rounded border-border"
            />
            <span className="text-xs text-muted-foreground">
              Enable auto AI review
            </span>
          </label>

          {error && (
            <p className="text-xs text-red-500 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="text-sm px-3 py-1.5 rounded-md border border-border hover:bg-muted"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {loading ? 'Creating…' : 'Create PR'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
