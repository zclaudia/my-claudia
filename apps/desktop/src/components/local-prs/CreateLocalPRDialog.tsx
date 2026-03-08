import { useState } from 'react';
import { X } from 'lucide-react';
import { useLocalPRStore } from '../../stores/localPRStore';

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
  const { createPR } = useLocalPRStore();
  const [worktreePath, setWorktreePath] = useState(defaultWorktreePath);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      <div className="bg-background border border-border rounded-xl shadow-xl w-full max-w-md p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold">Create Local PR</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground block mb-1">
              Worktree Path <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={worktreePath}
              onChange={(e) => setWorktreePath(e.target.value)}
              placeholder="/path/to/worktree"
              className="w-full text-sm bg-muted border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
            />
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
              className="w-full text-sm bg-muted border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary"
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
              className="w-full text-sm bg-muted border border-border rounded-md px-3 py-2 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            />
          </div>

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
