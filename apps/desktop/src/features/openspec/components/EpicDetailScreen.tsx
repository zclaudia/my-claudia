// apps/desktop/src/features/openspec/components/EpicDetailScreen.tsx
//
// Epic (C5: extracted from feature-issue) detail view. Shows Epic title +
// status, a list of LocalIssues that roll up into it, an "Add Sub-Issue"
// button, and a "Close Epic" button enabled only when every child issue is
// closed/cancelled.

import React, { useEffect, useState } from 'react';
import type { Epic } from '@my-claudia/shared/features/epic';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import { IssueStatusBadge, StatusBadge } from './StatusBadge.js';

interface Props {
  projectId: string;
  epicId: string;
}

export function EpicDetailScreen({
  projectId,
  epicId,
}: Props): React.ReactElement {
  const [epic, setEpic] = useState<Epic | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const subIssues = useOpenSpecStore((s) =>
    (s.issuesByProject[projectId] ?? []).filter((i) => i.epicId === epicId),
  );
  const patchView = useOpenSpecStore((s) => s.patchView);
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);

  useEffect(() => {
    let cancelled = false;
    api.getEpic(epicId)
      .then((value) => { if (!cancelled) setEpic(value); })
      .catch((e) => { if (!cancelled) setLoadError((e as Error).message); });
    api.listIssuesByEpic(epicId)
      .then((list) => list.forEach(upsertIssue))
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, [epicId, upsertIssue]);

  if (!epic) {
    return (
      <div className="p-4">
        <button
          className="text-sm text-primary hover:underline"
          onClick={() =>
            patchView(projectId, { screen: 'issues', selectedEpicId: undefined })
          }
        >
          ← Back to Issues
        </button>
        <div className="mt-2 text-sm text-muted-foreground">
          {loadError ? `Epic load failed: ${loadError}` : 'Epic not found.'}
        </div>
      </div>
    );
  }

  const allClosed =
    subIssues.length > 0 &&
    subIssues.every((i) => i.status === 'closed' || i.status === 'cancelled');

  const onClose = async (): Promise<void> => {
    try {
      const updated = await api.updateEpicStatus(epic.id, 'closed');
      setEpic(updated);
    } catch (e) {
      alert(`Close failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className="space-y-4">
      <nav className="text-sm text-muted-foreground flex items-center gap-2">
        <button
          className="text-primary hover:underline"
          onClick={() =>
            patchView(projectId, { screen: 'issues', selectedEpicId: undefined })
          }
        >
          ← Issues
        </button>
        <span>/</span>
        <span className="font-medium text-foreground">{epic.title}</span>
      </nav>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{epic.title}</h3>
          <div className="text-sm text-muted-foreground">
            epic · {subIssues.length} issue{subIssues.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={epic.status} />
          {epic.status === 'open' && (
            <button
              className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 disabled:opacity-50"
              disabled={!allClosed}
              title={allClosed ? 'Close this epic' : 'All issues must be closed first'}
              onClick={() => void onClose()}
            >
              Close Epic
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Issues</h4>
        <button
          className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
          onClick={() =>
            patchView(projectId, { showNewIssue: true, selectedEpicId: epic.id })
          }
        >
          + Add Sub-Issue
        </button>
      </div>

      {subIssues.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No issues yet. Click &quot;+ Add Sub-Issue&quot; to add one.
        </div>
      ) : (
        <ul className="space-y-2">
          {subIssues.map((s) => (
            <li
              key={s.id}
              className="border border-border rounded-md p-3 bg-card cursor-pointer hover:bg-secondary/30 transition-colors"
              onClick={() =>
                patchView(projectId, {
                  screen: 'sub-issue-detail',
                  selectedSubIssueId: s.id,
                })
              }
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{s.title}</div>
                  <div className="text-xs text-muted-foreground">{s.type}</div>
                </div>
                <IssueStatusBadge issue={s} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
