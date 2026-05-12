import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { Attachment, LocalIssue, LocalIssuePriority } from '@my-claudia/shared';
import { useLocalIssueStore } from '../store';
import { useAndroidBack } from '../../../hooks/useAndroidBack';
import { Select } from '../../../components/ui/Select';
import {
  AttachmentDropZone,
  AttachmentPicker,
  AttachmentList,
  uploadAttachment,
  useAttachments,
  filesFromDataTransfer,
} from '../../attachments';

interface CreateIssueDialogProps {
  projectId: string;
  onClose: () => void;
  editIssue?: LocalIssue;
  /** Pre-fills the form when creating a brand-new issue. Ignored in edit mode. */
  initialValues?: {
    title?: string;
    description?: string;
    priority?: LocalIssuePriority;
    labels?: string[];
  };
  /** Invoked with the freshly created issue after a successful create-mode submit.
   *  Lets callers chain post-create UX (toast, navigation, linking) without
   *  having to inspect the issues store. Not called in edit mode. */
  onCreated?: (issue: LocalIssue) => void;
}

const PRIORITY_OPTIONS: { value: LocalIssuePriority; label: string }[] = [
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

export function CreateIssueDialog({ projectId, onClose, editIssue, initialValues, onCreated }: CreateIssueDialogProps) {
  useAndroidBack(onClose, true, 25);
  const { createIssue, updateIssue } = useLocalIssueStore();
  const [title, setTitle] = useState(editIssue?.title ?? initialValues?.title ?? '');
  const [description, setDescription] = useState(editIssue?.description ?? initialValues?.description ?? '');
  const [priority, setPriority] = useState<LocalIssuePriority>(
    editIssue?.priority ?? initialValues?.priority ?? 'medium',
  );
  const [labelInput, setLabelInput] = useState(
    editIssue?.labels?.join(', ') ?? initialValues?.labels?.join(', ') ?? '',
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEdit = !!editIssue;

  // For edit mode, attach directly to the existing issue. For create mode we
  // queue files locally and upload after the issue is created.
  const editAttachments = useAttachments(isEdit ? 'local_issue' : null, isEdit ? editIssue?.id : null);
  const [pending, setPending] = useState<PendingAttachment[]>([]);

  // Track URLs so we can revoke on unmount even if `pending` was cleared
  // (e.g. via dialog close after submit) before the cleanup runs.
  const previewUrlsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    return () => {
      for (const url of previewUrlsRef.current) URL.revokeObjectURL(url);
      previewUrlsRef.current.clear();
    };
  }, []);

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
    // Create object URLs synchronously so the very first render after adding
    // already shows the thumbnail. Mutating the URL onto the entry inside an
    // effect would lose the thumbnail on the just-added file because no
    // re-render is scheduled by that mutation.
    const additions: PendingAttachment[] = files.map((file) => {
      let previewUrl: string | undefined;
      if (file.type.startsWith('image/')) {
        previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
      }
      return {
        localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        previewUrl,
      };
    });
    setPending((prev) => [...prev, ...additions]);
  };

  const removePending = (localId: string) => {
    setPending((prev) => {
      const target = prev.find((p) => p.localId === localId);
      if (target?.previewUrl) {
        URL.revokeObjectURL(target.previewUrl);
        previewUrlsRef.current.delete(target.previewUrl);
      }
      return prev.filter((p) => p.localId !== localId);
    });
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLFormElement>) => {
    const files = filesFromDataTransfer(e.clipboardData?.items);
    if (files.length === 0) return;
    e.preventDefault();
    void addFiles(files);
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

        onCreated?.(created);
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
            className="relative w-16 h-16 rounded-md border border-border bg-secondary flex items-center justify-center overflow-hidden text-[10px] text-muted-foreground"
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
              className="absolute top-0.5 right-0.5 p-0.5 rounded-md bg-background/90 text-muted-foreground hover:text-red-500"
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-lg w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold">{isEdit ? 'Edit Issue' : 'New Issue'}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>

        <AttachmentDropZone onFiles={addFiles} className="rounded-b-lg flex-1 min-h-0 flex flex-col" label="Drop files to attach">
          <form onSubmit={handleSubmit} onPaste={handlePaste} className="p-4 space-y-3 flex-1 overflow-y-auto">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                placeholder="Issue title"
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary min-h-[240px] resize-y leading-relaxed"
                placeholder="Describe the issue (optional, markdown supported)"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Priority</label>
              <Select<LocalIssuePriority>
                value={priority}
                onChange={setPriority}
                block
                size="md"
                className="mt-1"
                options={PRIORITY_OPTIONS}
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Labels</label>
              <input
                type="text"
                value={labelInput}
                onChange={(e) => setLabelInput(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
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
                className="px-3 py-1.5 text-xs rounded-md bg-secondary text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !title.trim()}
                className="px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
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
