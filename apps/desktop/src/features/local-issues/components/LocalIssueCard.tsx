import type { LocalIssue } from '@my-claudia/shared';
import { Paperclip, ChevronRight, Zap } from 'lucide-react';
import { ACTIONABLE_LABEL } from '@my-claudia/shared';
import { useAttachmentCount } from '../../attachments';

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
  onOpen: (issueId: string) => void;
}

export function LocalIssueCard({ issue, onOpen }: LocalIssueCardProps) {
  const attachmentCount = useAttachmentCount('local_issue', issue.id);
  const timeText = formatTimeAgo(issue.createdAt);

  return (
    <button
      type="button"
      onClick={() => onOpen(issue.id)}
      className="w-full text-left border border-border rounded-lg bg-card hover:bg-secondary/50 transition-colors group"
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${STATUS_COLORS[issue.status] ?? ''}`}>
          {issue.status.replace('_', ' ')}
        </span>

        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0 ${PRIORITY_COLORS[issue.priority] ?? ''}`}>
          {issue.priority}
        </span>

        {issue.labels.includes(ACTIONABLE_LABEL) && (
          <span
            title="Ready to execute"
            aria-label="Ready to execute"
            className="shrink-0 inline-flex items-center"
          >
            <Zap size={12} className="text-amber-500" aria-hidden />
          </span>
        )}

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

        {attachmentCount > 0 && (
          <span
            className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground shrink-0"
            title={`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`}
          >
            <Paperclip className="w-3 h-3" />
            {attachmentCount}
          </span>
        )}

        <span className="text-xs text-muted-foreground shrink-0">{timeText}</span>

        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />
      </div>
    </button>
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
