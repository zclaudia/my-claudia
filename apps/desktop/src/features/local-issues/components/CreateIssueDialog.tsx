import { useState } from 'react';
import { X } from 'lucide-react';
import { useLocalIssueStore } from '../store';
import { useAndroidBack } from '../../../hooks/useAndroidBack';
import type { LocalIssue, LocalIssuePriority } from '@my-claudia/shared';

interface CreateIssueDialogProps {
  projectId: string;
  onClose: () => void;
  editIssue?: LocalIssue;
}

const PRIORITY_OPTIONS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

export function CreateIssueDialog({ projectId, onClose, editIssue }: CreateIssueDialogProps) {
  useAndroidBack(onClose, true, 25);
  const { createIssue, updateIssue } = useLocalIssueStore();
  const [title, setTitle] = useState(editIssue?.title ?? '');
  const [description, setDescription] = useState(editIssue?.description ?? '');
  const [priority, setPriority] = useState<LocalIssuePriority>(editIssue?.priority ?? 'medium');
  const [labelInput, setLabelInput] = useState(editIssue?.labels?.join(', ') ?? '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!editIssue;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const labels = labelInput
        .split(',')
        .map((l) => l.trim())
        .filter(Boolean);

      if (isEdit) {
        await updateIssue(editIssue.id, projectId, {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          labels,
        });
      } else {
        await createIssue(projectId, {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          labels,
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save issue');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">{isEdit ? 'Edit Issue' : 'New Issue'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Issue title"
              autoFocus
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary min-h-[80px] resize-y"
              placeholder="Describe the issue (optional)"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Priority</label>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as LocalIssuePriority)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Labels</label>
            <input
              type="text"
              value={labelInput}
              onChange={(e) => setLabelInput(e.target.value)}
              className="mt-1 w-full rounded border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="bug, enhancement, ... (comma-separated)"
            />
          </div>

          {error && <div className="text-xs text-red-500">{error}</div>}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs rounded bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !title.trim()}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : isEdit ? 'Save' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
