// apps/desktop/src/features/openspec/components/AnonymousManagementPanel.tsx
//
// Settings-style panel that lists every isAnonymous=true issue in a project
// and lets the user bulk-cancel a selection. Reached from the anonymous fold
// in IssueListScreen ("Manage Anonymous Issues →"). Provides a breadcrumb
// back to the issue list.

import React, { useState } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  projectId: string;
}

export function AnonymousManagementPanel({ projectId }: Props): React.ReactElement {
  const anonymous = useOpenSpecStore((s) =>
    (s.issuesByProject[projectId] ?? []).filter((i) => i.isAnonymous),
  );
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);
  const patchView = useOpenSpecStore((s) => s.patchView);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (id: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllOpen = (): void => {
    setSelected(
      new Set(
        anonymous
          .filter((i) => i.status !== 'closed' && i.status !== 'cancelled')
          .map((i) => i.id),
      ),
    );
  };

  const bulkCancel = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      for (const id of selected) {
        const issue = await api.transitionStatus(id, 'cancelled');
        upsertIssue(issue);
      }
      setSelected(new Set());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const closedCount = anonymous.filter(
    (i) => i.status === 'closed' || i.status === 'cancelled',
  ).length;
  const openCount = anonymous.length - closedCount;

  return (
    <div className="space-y-4 max-w-3xl">
      <nav className="text-sm text-muted-foreground">
        <button
          className="text-primary hover:underline"
          onClick={() => patchView(projectId, { screen: 'issues' })}
        >
          ← Issues
        </button>
        <span className="mx-2">/</span>
        <span className="text-foreground font-medium">Manage Anonymous Issues</span>
      </nav>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Anonymous Issues</h3>
          <div className="text-xs text-muted-foreground mt-1">
            {openCount} open · {closedCount} closed/cancelled · {anonymous.length} total
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            onClick={selectAllOpen}
          >
            Select all open
          </button>
          <button
            className="px-2.5 py-1.5 text-xs rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25 disabled:opacity-50"
            disabled={busy || selected.size === 0}
            onClick={() => void bulkCancel()}
          >
            Cancel selected ({selected.size})
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-500">Error: {error}</div>}

      {anonymous.length === 0 ? (
        <div className="text-sm text-muted-foreground border border-border rounded-md p-4 bg-muted/30 text-center">
          No anonymous issues.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {anonymous.map((i) => (
            <li
              key={i.id}
              className="border border-border rounded-md p-2 bg-card flex items-center gap-2"
            >
              <input
                type="checkbox"
                checked={selected.has(i.id)}
                onChange={() => toggle(i.id)}
                disabled={i.status === 'closed' || i.status === 'cancelled'}
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{i.title}</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">
                  {new Date(i.createdAt).toLocaleDateString()}
                </div>
              </div>
              <StatusBadge status={i.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
