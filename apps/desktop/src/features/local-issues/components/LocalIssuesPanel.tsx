import { useEffect, useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import type { LocalIssue, LocalIssueStatus } from '@my-claudia/shared';
import { useLocalIssueStore } from '../store';
import { useAttachmentCounts } from '../../attachments';
import { LocalIssueCard } from './LocalIssueCard';
import { CreateIssueDialog } from './CreateIssueDialog';

interface LocalIssuesPanelProps {
  projectId: string;
}

type FilterStatus = 'all' | LocalIssueStatus;

const FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'closed', label: 'Closed' },
];

const PRIORITY_ORDER: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function LocalIssuesPanel({ projectId }: LocalIssuesPanelProps) {
  const issues = useLocalIssueStore((s) => s.issues[projectId] ?? []);
  const loadIssues = useLocalIssueStore((s) => s.loadIssues);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [showCreate, setShowCreate] = useState(false);
  const [editIssue, setEditIssue] = useState<LocalIssue | null>(null);

  useEffect(() => {
    loadIssues(projectId).catch(() => {});
  }, [projectId]);

  // Batch fetch attachment counts so every card shows its badge without
  // each card making its own request.
  const issueIds = useMemo(() => issues.map((i) => i.id), [issues]);
  useAttachmentCounts('local_issue', issueIds);

  const filtered = issues
    .filter((issue) => filter === 'all' || issue.status === filter)
    .sort((a, b) => {
      // Open/in_progress first, then by priority, then by creation time
      const statusOrder = (s: string) => (s === 'closed' ? 1 : 0);
      const sd = statusOrder(a.status) - statusOrder(b.status);
      if (sd !== 0) return sd;
      const pd = (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9);
      if (pd !== 0) return pd;
      return b.createdAt - a.createdAt;
    });

  const counts = {
    all: issues.length,
    open: issues.filter((i) => i.status === 'open').length,
    in_progress: issues.filter((i) => i.status === 'in_progress').length,
    closed: issues.filter((i) => i.status === 'closed').length,
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setFilter(opt.value)}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                filter === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
              <span className="ml-1 opacity-60">{counts[opt.value]}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="w-3 h-3" />
          New Issue
        </button>
      </div>

      {/* Issue List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <p className="text-sm">No issues found.</p>
            <p className="text-xs mt-1">
              {filter === 'all'
                ? 'Create an issue to track problems you want to solve later.'
                : `No ${filter.replace('_', ' ')} issues.`}
            </p>
          </div>
        ) : (
          filtered.map((issue) => (
            <LocalIssueCard
              key={issue.id}
              issue={issue}
              projectId={projectId}
              onEdit={setEditIssue}
            />
          ))
        )}
      </div>

      {/* Dialogs */}
      {showCreate && (
        <CreateIssueDialog
          projectId={projectId}
          onClose={() => setShowCreate(false)}
        />
      )}
      {editIssue && (
        <CreateIssueDialog
          projectId={projectId}
          editIssue={editIssue}
          onClose={() => setEditIssue(null)}
        />
      )}
    </div>
  );
}
