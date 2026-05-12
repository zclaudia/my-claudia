import { useEffect, useState } from 'react';
import { MessageSquare, Pencil, Trash2, X, Check, Loader2 } from 'lucide-react';
import type { LocalIssueComment } from '@my-claudia/shared';
import { useLocalIssueCommentStore } from '../comments-store';
import { IssueMarkdown } from './IssueMarkdown';
import { timeAgo } from '../../../utils/timeAgo';

interface CommentListProps {
  issueId: string;
}

export function CommentList({ issueId }: CommentListProps) {
  const comments = useLocalIssueCommentStore((s) => s.comments[issueId] ?? []);
  const loading = useLocalIssueCommentStore((s) => s.loading[issueId] ?? false);
  const loadComments = useLocalIssueCommentStore((s) => s.loadComments);

  useEffect(() => {
    void loadComments(issueId);
  }, [issueId, loadComments]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
        <MessageSquare className="w-3.5 h-3.5" />
        Comments
        <span className="text-muted-foreground/70 font-normal">({comments.length})</span>
        {loading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground/70" />}
      </div>

      {comments.length === 0 && !loading ? (
        <p className="text-xs text-muted-foreground italic">No comments yet.</p>
      ) : (
        <div className="space-y-2">
          {comments.map((c) => (
            <CommentItem key={c.id} comment={c} />
          ))}
        </div>
      )}

      <CommentComposer issueId={issueId} />
    </div>
  );
}

function CommentItem({ comment }: { comment: LocalIssueComment }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editComment = useLocalIssueCommentStore((s) => s.editComment);
  const removeComment = useLocalIssueCommentStore((s) => s.removeComment);

  const wasEdited = comment.updatedAt > comment.createdAt + 500;

  const handleSave = async () => {
    if (!draft.trim()) {
      setError('Comment cannot be empty');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await editComment(comment.id, draft.trim());
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save comment');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm('Delete this comment?')) return;
    try {
      await removeComment(comment.id);
    } catch (err) {
      // Re-show the comment by surfacing error in console — store stays consistent
      console.error('Failed to delete comment:', err);
    }
  };

  const handleCancel = () => {
    setDraft(comment.body);
    setError(null);
    setEditing(false);
  };

  return (
    <div className="border border-border rounded-md bg-card">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/60 text-[11px] text-muted-foreground">
        <span>{timeAgo(comment.createdAt)}</span>
        {wasEdited && <span className="text-muted-foreground/70">· edited {timeAgo(comment.updatedAt)}</span>}
        <div className="flex-1" />
        {!editing && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="p-0.5 hover:text-foreground"
              title="Edit comment"
            >
              <Pencil className="w-3 h-3" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="p-0.5 hover:text-red-500"
              title="Delete comment"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </>
        )}
      </div>
      <div className="px-3 py-2">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full min-h-[80px] rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-y"
              autoFocus
            />
            {error && <div className="text-[11px] text-red-500">{error}</div>}
            <div className="flex justify-end gap-1.5">
              <button
                type="button"
                onClick={handleCancel}
                disabled={saving}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-secondary text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                <X className="w-3 h-3" />
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving || !draft.trim()}
                className="inline-flex items-center gap-1 px-2 py-1 text-[11px] rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save
              </button>
            </div>
          </div>
        ) : (
          <IssueMarkdown content={comment.body} compact />
        )}
      </div>
    </div>
  );
}

function CommentComposer({ issueId }: { issueId: string }) {
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const addComment = useLocalIssueCommentStore((s) => s.addComment);

  const submit = async () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    setSending(true);
    setError(null);
    try {
      await addComment(issueId, trimmed);
      setBody('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add comment');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="border border-border rounded-md bg-card">
      <div className="px-3 py-2">
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault();
              void submit();
            }
          }}
          placeholder="Add a comment… (⌘+Enter to send, supports markdown)"
          className="w-full min-h-[60px] rounded-md border border-border bg-background px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary resize-y"
        />
        {error && <div className="text-[11px] text-red-500 mt-1">{error}</div>}
        <div className="flex justify-end mt-2">
          <button
            type="button"
            onClick={submit}
            disabled={sending || !body.trim()}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageSquare className="w-3 h-3" />}
            Comment
          </button>
        </div>
      </div>
    </div>
  );
}
