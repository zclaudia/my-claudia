import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { Attachment, LocalIssue, LocalIssuePriority } from '@my-claudia/shared';
import { useLocalIssueStore } from '../store';
import { useAndroidBack } from '../../../hooks/useAndroidBack';
import {
  AttachmentDropZone,
  AttachmentPicker,
  AttachmentList,
  uploadAttachment,
  useAttachments,
} from '../../attachments';

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

/**
 * Pending attachment, held in memory while creating a brand-new issue.
 * Created issues use a delayed-upload strategy to avoid orphan rows when the
 * user cancels.
 */
interface PendingAttachment {
  localId: string;
  file: File;
  previewUrl?: string;
}

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

  // For edit mode, attach directly to the existing issue. For create mode we
  // queue files locally and upload after the issue is created.
  const editAttachments = useAttachments(isEdit ? 'local_issue' : null, isEdit ? editIssue?.id : null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);

  // Generate object URLs for image previews so the user can verify selection
  // before submitting. Revoked on unmount / list change.
  useEffect(() => {
    if (isEdit) return;
    const urls = pending.map((p) => {
      if (p.previewUrl || !p.file.type.startsWith('image/')) return p.previewUrl;
      const url = URL.createObjectURL(p.file);
      p.previewUrl = url;
      return url;
    });
    return () => {
      for (const u of urls) {
        if (u) URL.revokeObjectURL(u);
      }
    };
  }, [pending, isEdit]);

  const addFiles = async (files: File[]) => {
    if (files.length === 0) return;
    if (isEdit && editIssue) {
      try {
        for (const file of files) {
          await editAttachments.upload(file);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Upload failed');
      }
      return;
    }
    setPending((prev) => [
      ...prev,
      ...files.map((file) => ({
        localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
      })),
    ]);
  };

  const removePending = (localId: string) => {
    setPending((prev) => prev.filter((p) => p.localId !== localId));
  };

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
        const created = await createIssue(projectId, {
          title: title.trim(),
          description: description.trim() || undefined,
          priority,
          labels,
        });

        // Best-effort upload — failures don't roll back the issue (it's already
        // visible) but we surface the first error to the user.
        for (const p of pending) {
          try {
            await uploadAttachment('local_issue', created.id, p.file);
          } catch (uploadErr) {
            setError(
              uploadErr instanceof Error
                ? `Issue saved but upload of "${p.file.name}" failed: ${uploadErr.message}`
                : `Upload of "${p.file.name}" failed`,
            );
          }
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save issue');
    } finally {
      setLoading(false);
    }
  };

  const renderPendingThumbs = () => {
    if (pending.length === 0) return null;
    return (
      <div className="flex flex-wrap gap-2">
        {pending.map((p) => (
          <div
            key={p.localId}
            data-testid="pending-attachment"
            className="relative w-16 h-16 rounded border border-border bg-secondary flex items-center justify-center overflow-hidden text-[10px] text-muted-foreground"
            title={p.file.name}
          >
            {p.previewUrl ? (
              <img src={p.previewUrl} alt={p.file.name} className="h-full w-full object-cover" />
            ) : (
              <span className="px-1 truncate">{p.file.name}</span>
            )}
            <button
              type="button"
              onClick={() => removePending(p.localId)}
              className="absolute top-0.5 right-0.5 p-0.5 rounded bg-background/90 text-muted-foreground hover:text-red-500"
              aria-label={`Remove ${p.file.name}`}
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
      </div>
    );
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

        <AttachmentDropZone onFiles={addFiles} className="rounded-b-lg" label="Drop files to attach">
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

            <div>
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted-foreground">Attachments</label>
                <AttachmentPicker onFiles={addFiles} multiple ariaLabel="Add attachment" />
              </div>
              <div className="mt-2">
                {isEdit ? (
                  <AttachmentList
                    items={editAttachments.items as Attachment[]}
                    onRemove={(id) => void editAttachments.remove(id)}
                    emptyText="Drop files here or click Attach"
                    sortable
                    ownerKind="local_issue"
                    ownerId={editIssue?.id}
                  />
                ) : pending.length > 0 ? (
                  renderPendingThumbs()
                ) : (
                  <div className="text-[11px] text-muted-foreground italic">
                    Drop files here or click Attach
                  </div>
                )}
              </div>
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
        </AttachmentDropZone>
      </div>
    </div>
  );
}
