// apps/desktop/src/features/openspec/components/StatusBadge.tsx
//
// Small reusable badge for issue + executor statuses. Colors follow the
// saturated /10 + /15 pattern (matches Meta Workflow E2b convention).

import React from 'react';
import type { LocalIssueStatus } from '@my-claudia/shared/features/local-issue';
import type { ExecutorStatus } from '@my-claudia/shared/features/executor';

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-secondary text-muted-foreground',
  planning: 'bg-blue-500/10 text-blue-500',
  tasks_ready: 'bg-blue-500/15 text-blue-600',
  executing: 'bg-yellow-500/10 text-yellow-600',
  reviewing: 'bg-orange-500/10 text-orange-500',
  closed: 'bg-green-500/10 text-green-600',
  cancelled: 'bg-red-500/10 text-red-500',
  // executor only:
  pending: 'bg-secondary text-muted-foreground',
  paused: 'bg-yellow-500/10 text-yellow-600',
  completed: 'bg-green-500/10 text-green-600',
  failed: 'bg-red-500/10 text-red-500',
};

export function StatusBadge({
  status,
}: {
  status: LocalIssueStatus | ExecutorStatus;
}): React.ReactElement {
  const cls = STATUS_COLORS[status] ?? 'bg-secondary text-muted-foreground';
  return <span className={`px-2 py-0.5 rounded-md text-xs font-mono ${cls}`}>{status}</span>;
}
