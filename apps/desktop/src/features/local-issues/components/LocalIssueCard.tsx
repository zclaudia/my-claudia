import { useState } from 'react';
import type { LocalIssue } from '@my-claudia/shared';
import { ChevronDown, ChevronRight, Pencil, X, RotateCcw, Trash2 } from 'lucide-react';
import { useLocalIssueStore } from '../store';

const PRIORITY_COLORS: Record<string, string> = {
  low: 'bg-gray-500/10 text-gray-400',
  medium: 'bg-blue-500/10 text-blue-500',
  high: 'bg-orange-500/10 text-orange-500',
  critical: 'bg-red-500/10 text-red-500',
};

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-green-500/10 text-green-500',
  in_progress: 'bg-blue-500/10 text-blue-500',
  closed: 'bg-gray-500/10 text-gray-400',
};

interface LocalIssueCardProps {
  issue: LocalIssue;
  projectId: string;
  onEdit: (issue: LocalIssue) => void;
}

export function LocalIssueCard({ issue, projectId, onEdit }: LocalIssueCardProps) {
  const [expanded, setExpanded] = useState(false);
  const { closeIssue, reopenIssue, deleteIssue, updateIssue } = useLocalIssueStore();

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
    await deleteIssue(issue.id, projectId);
  };

  const timeAgo = formatTimeAgo(issue.createdAt);

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
        </button>

        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[issue.status] ?? ''}`}>
          {issue.status.replace('_', ' ')}
        </span>

        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${PRIORITY_COLORS[issue.priority] ?? ''}`}>
          {issue.priority}
        </span>

        <span className="text-sm truncate flex-1">{issue.title}</span>

        {issue.labels.length > 0 && (
          <div className="flex gap-1 shrink-0">
            {issue.labels.map((label) => (
              <span
                key={label}
                className="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400"
              >
                {label}
              </span>
            ))}
          </div>
        )}

        <span className="text-xs text-muted-foreground shrink-0">{timeAgo}</span>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onEdit(issue)}
            className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
            title="Edit"
          >
            <Pencil className="w-3 h-3" />
          </button>
          {issue.status === 'closed' ? (
            <button
              onClick={handleStatusToggle}
              className="p-1 text-muted-foreground hover:text-green-500 rounded transition-colors"
              title="Reopen"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          ) : (
            <button
              onClick={handleStatusToggle}
              className="p-1 text-muted-foreground hover:text-foreground rounded transition-colors"
              title={issue.status === 'open' ? 'Start' : 'Close'}
            >
              <X className="w-3 h-3" />
            </button>
          )}
          <button
            onClick={handleDelete}
            className="p-1 text-muted-foreground hover:text-red-500 rounded transition-colors"
            title="Delete"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      </div>

      {expanded && issue.description && (
        <div className="px-3 pb-2 pt-0 ml-6">
          <div className="text-xs text-muted-foreground whitespace-pre-wrap">{issue.description}</div>
        </div>
      )}
    </div>
  );
}

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}
