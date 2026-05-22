// apps/desktop/src/features/openspec/components/FeatureIssueDetailScreen.tsx
//
// Parent feature detail view. Shows the feature title + status, a list of
// sub-issues with their statuses, an "Add Sub-Issue" button (opens dialog via
// view state), and a "Close Feature" button which is enabled only when every
// sub-issue is closed/cancelled. Renders inside OpenSpecPanel when
// view.screen === 'feature-detail'.

import React, { useEffect } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  projectId: string;
  featureId: string;
}

export function FeatureIssueDetailScreen({
  projectId,
  featureId,
}: Props): React.ReactElement {
  const feature = useOpenSpecStore((s) =>
    (s.issuesByProject[projectId] ?? []).find((i) => i.id === featureId),
  );
  const subIssues = useOpenSpecStore((s) =>
    (s.issuesByProject[projectId] ?? []).filter((i) => i.parentIssueId === featureId),
  );
  const patchView = useOpenSpecStore((s) => s.patchView);
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);

  useEffect(() => {
    void api
      .listSubIssues(featureId)
      .then((list) => list.forEach(upsertIssue))
      .catch(() => undefined);
  }, [featureId, upsertIssue]);

  if (!feature) {
    return (
      <div className="p-4">
        <button
          className="text-sm text-primary hover:underline"
          onClick={() =>
            patchView(projectId, { screen: 'issues', selectedFeatureId: undefined })
          }
        >
          ← Back to Issues
        </button>
        <div className="mt-2 text-sm text-muted-foreground">Feature not found.</div>
      </div>
    );
  }

  const allClosed =
    subIssues.length > 0 &&
    subIssues.every((i) => i.status === 'closed' || i.status === 'cancelled');

  const onClose = async (): Promise<void> => {
    try {
      const issue = await api.transitionStatus(feature.id, 'closed');
      upsertIssue(issue);
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
            patchView(projectId, { screen: 'issues', selectedFeatureId: undefined })
          }
        >
          ← Issues
        </button>
        <span>/</span>
        <span className="font-medium text-foreground">{feature.title}</span>
      </nav>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{feature.title}</h3>
          <div className="text-sm text-muted-foreground">
            feature · {subIssues.length} sub-issue{subIssues.length === 1 ? '' : 's'}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={feature.status} />
          {feature.status === 'open' && (
            <button
              className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 disabled:opacity-50"
              disabled={!allClosed}
              title={allClosed ? 'Close this feature' : 'All sub-issues must be closed first'}
              onClick={() => void onClose()}
            >
              Close Feature
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold">Sub-Issues</h4>
        <button
          className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
          onClick={() =>
            patchView(projectId, { showNewIssue: true, selectedFeatureId: feature.id })
          }
        >
          + Add Sub-Issue
        </button>
      </div>

      {subIssues.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No sub-issues yet. Click &quot;+ Add Sub-Issue&quot; to add one.
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
                <StatusBadge status={s.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
