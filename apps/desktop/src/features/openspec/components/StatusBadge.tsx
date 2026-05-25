// apps/desktop/src/features/openspec/components/StatusBadge.tsx
//
// Small reusable badge for issue + executor + spec-change statuses. Colors
// follow the saturated /10 + /15 pattern (matches Meta Workflow E2b
// convention).

import React from 'react';
import type { LocalIssue, LocalIssueStatus } from '@my-claudia/shared/features/local-issue';
import type { ExecutorStatus } from '@my-claudia/shared/features/executor';
import type { SpecChangeStatus } from '@my-claudia/shared/features/spec-change';
import { useOpenSpecStore } from '../store.js';

const STATUS_COLORS: Record<string, string> = {
  // LocalIssue (4 lifecycle states)
  open: 'bg-secondary text-muted-foreground',
  tracked: 'bg-blue-500/10 text-blue-500',
  closed: 'bg-green-500/10 text-green-600',
  cancelled: 'bg-red-500/10 text-red-500',
  // SpecChange (full workflow — projected via IssueStatusBadge)
  drafting: 'bg-secondary text-muted-foreground',
  proposing: 'bg-blue-500/10 text-blue-500',
  designing: 'bg-blue-500/15 text-blue-600',
  tasks_ready: 'bg-blue-500/15 text-blue-600',
  archived: 'bg-green-500/10 text-green-600',
  // Executor
  pending: 'bg-secondary text-muted-foreground',
  executing: 'bg-yellow-500/10 text-yellow-600',
  paused: 'bg-yellow-500/10 text-yellow-600',
  completed: 'bg-green-500/10 text-green-600',
  failed: 'bg-red-500/10 text-red-500',
};

export function StatusBadge({
  status,
}: {
  status: LocalIssueStatus | ExecutorStatus | SpecChangeStatus;
}): React.ReactElement {
  const cls = STATUS_COLORS[status] ?? 'bg-secondary text-muted-foreground';
  return <span className={`px-2 py-0.5 rounded-md text-xs font-mono ${cls}`}>{status}</span>;
}

/**
 * Renders an Issue's status with workflow-state projection:
 * - If the issue has a `specChangeId` and the SpecChange is loaded, show the
 *   SpecChange's status (the real workflow state).
 * - Otherwise, fall back to the issue's own lifecycle status.
 *
 * Feature-issues never carry a SpecChange, so they naturally fall back to
 * their own `open/closed/cancelled` lifecycle.
 */
export function IssueStatusBadge({ issue }: { issue: LocalIssue }): React.ReactElement {
  const specChange = useOpenSpecStore((s) =>
    issue.specChangeId ? s.specChangesById[issue.specChangeId] : undefined,
  );
  const status: LocalIssueStatus | SpecChangeStatus = specChange ? specChange.status : issue.status;
  return <StatusBadge status={status} />;
}
