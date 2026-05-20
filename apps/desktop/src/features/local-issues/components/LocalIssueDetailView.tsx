import { useState } from 'react';
import {
  Pencil,
  RotateCcw,
  Trash2,
  X,
  Paperclip,
  Zap,
} from 'lucide-react';
import type { LocalIssue } from '@my-claudia/shared';
import { ACTIONABLE_LABEL } from '@my-claudia/shared';
import { useLocalIssueStore } from '../store';
import { AttachmentList, useAttachments, useAttachmentCount } from '../../attachments';
import { CreateIssueDialog } from './CreateIssueDialog';
import { IssueMarkdown } from './IssueMarkdown';
import { CommentList } from './CommentList';
import { timeAgo } from '../../../utils/timeAgo';

interface LocalIssueDetailViewProps {
  issue: LocalIssue;
  projectId: string;
  /** Called after the issue is deleted so the parent can drop selection. */
  onDeleted: () => void;
}

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-500/10 text-gray-500 dark:text-gray-400',
  medium: 'bg-blue-500/10 text-blue-500',
  high: 'bg-orange-500/10 text-orange-500',
  critical: 'bg-red-500/10 text-red-500',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-500/10 text-green-600 dark:text-green-400',
  in_progress: 'bg-blue-500/10 text-blue-500',
  closed: 'bg-gray-500/10 text-gray-500 dark:text-gray-400',
};

export function LocalIssueDetailView({ issue, projectId, onDeleted }: LocalIssueDetailViewProps) {
  const { closeIssue, reopenIssue, deleteIssue, updateIssue } = useLocalIssueStore();
  const [editing, setEditing] = useState(false);

  const attachmentCount = useAttachmentCount('local_issue', issue.id);
  const attachments = useAttachments('local_issue', issue.id);

  const handleStatusToggle = async () => {
    if (issue.status === 'closed') {
      await reopenIssue(issue.id, projectId);
    } else if (issue.status === 'open') {
      await updateIssue(issue.id, projectId, { status: 'in_progress' });
    } else {
      await closeIssue(issue.id, projectId);
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete issue "${issue.title}"? This cannot be undone.`)) return;
    await deleteIssue(issue.id, projectId);
    onDeleted();
  };

  const closed = issue.status === 'closed';
  const wasEdited = issue.updatedAt > issue.createdAt + 500;

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Header — title + status chips + inline action icons on the right.
            Back navigation lives in the outer ProjectDashboard breadcrumb
            ("Issues / <title>"), so this view has no toolbar of its own. */}
        <header className="space-y-2">
          <div className="flex items-start gap-3">
            <div className="flex-1 min-w-0 space-y-1.5">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${STATUS_COLORS[issue.status] ?? ''}`}>
                  {issue.status.replace('_', ' ')}
                </span>
                <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-full ${PRIORITY_COLORS[issue.priority] ?? ''}`}>
                  {issue.priority}
                </span>
                {issue.labels.map((label) => (
                  <span
                    key={label}
                    className="text-[11px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-500 dark:text-purple-400"
                  >
                    {label}
                  </span>
                ))}
              </div>
              <div className="flex items-start gap-1.5">
                {issue.labels.includes(ACTIONABLE_LABEL) && (
                  <span
                    title="Ready to execute"
                    aria-label="Ready to execute"
                    className="shrink-0 inline-flex items-center mt-0.5"
                  >
                    <Zap size={14} className="text-amber-500" aria-hidden />
                  </span>
                )}
                <h1 className="text-base font-semibold leading-snug break-words flex-1">{issue.title}</h1>
              </div>
            </div>
            <div className="flex items-center gap-0.5 flex-shrink-0 -mt-0.5">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary"
                title="Edit issue"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              {closed ? (
                <button
                  type="button"
                  onClick={handleStatusToggle}
                  className="p-1.5 text-muted-foreground hover:text-green-500 rounded-md hover:bg-secondary"
                  title="Reopen"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleStatusToggle}
                  className="p-1.5 text-muted-foreground hover:text-foreground rounded-md hover:bg-secondary"
                  title={issue.status === 'open' ? 'Move to In Progress' : 'Close'}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={handleDelete}
                className="p-1.5 text-muted-foreground hover:text-red-500 rounded-md hover:bg-secondary"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground flex items-center gap-2 flex-wrap">
            <span>Created {timeAgo(issue.createdAt)}</span>
            {wasEdited && <span>· Updated {timeAgo(issue.updatedAt)}</span>}
            {issue.closedAt && <span>· Closed {timeAgo(issue.closedAt)}</span>}
            {attachmentCount > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Paperclip className="w-3 h-3" />
                {attachmentCount} attachment{attachmentCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </header>

        {/* Description */}
        <section className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
            Description
          </div>
          <div className="border border-border rounded-md bg-card px-3 py-2">
            {issue.description?.trim() ? (
              <IssueMarkdown content={issue.description} />
            ) : (
              <p className="text-xs italic text-muted-foreground">No description.</p>
            )}
          </div>
        </section>

        {/* Attachments */}
        {attachmentCount > 0 && (
          <section className="space-y-1.5">
            <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
              Attachments
            </div>
            <AttachmentList
              items={attachments.items}
              onRemove={(id) => void attachments.remove(id)}
              sortable
              ownerKind="local_issue"
              ownerId={issue.id}
            />
          </section>
        )}

        {/* Comments */}
        <section>
          <CommentList issueId={issue.id} />
        </section>
      </div>

      {editing && (
        <CreateIssueDialog
          projectId={projectId}
          editIssue={issue}
          onClose={() => setEditing(false)}
        />
      )}
    </div>
  );
}
