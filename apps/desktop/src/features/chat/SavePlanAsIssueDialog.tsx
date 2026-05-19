import { useState } from 'react';
import { X } from 'lucide-react';
import { useAndroidBack } from '../../hooks/useAndroidBack';

interface SavePlanAsIssueDialogProps {
  defaultTitle: string;
  submitting?: boolean;
  onSave: (title: string) => void;
  onCancel: () => void;
}

export function SavePlanAsIssueDialog({
  defaultTitle,
  submitting,
  onSave,
  onCancel,
}: SavePlanAsIssueDialogProps) {
  useAndroidBack(onCancel, true, 25);
  const [title, setTitle] = useState(defaultTitle);
  const canSave = !submitting && title.trim().length > 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    onSave(title.trim());
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onCancel}
    >
      <div
        className="bg-card border border-border rounded-lg shadow-lg w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Save plan as issue</h2>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-4 space-y-3">
          <div>
            <label
              htmlFor="save-plan-title"
              className="text-xs font-medium text-muted-foreground"
            >
              Title
            </label>
            <input
              id="save-plan-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              placeholder="Issue title"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="px-3 py-1.5 text-xs rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
