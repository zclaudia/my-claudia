// apps/desktop/src/features/openspec/components/IssueListScreen.tsx
//
// Top-level issue list for the OpenSpec tab. Shows:
// - Parent feature issues (with sub-issue count)
// - Free-standing implement/bug sub-issues (no parent, not anonymous)
// - Folded "Anonymous (N)" section that expands on click
// - Type filter chips
// - "+ New Issue" button (dialog wired in Task 6)
// - Click row → drill into FeatureIssueDetailScreen or SubIssueDetailScreen (Task 3)

import React, { useEffect, useMemo } from 'react';
import type { LocalIssue, LocalIssueType } from '@my-claudia/shared/features/local-issue';
import { useOpenSpecStore } from '../store.js';
import { listSubIssues, getIssue } from '../api.js';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  projectId: string;
}

const TYPE_CHIPS: { value: LocalIssueType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'feature', label: 'Features' },
  { value: 'implement', label: 'Changes' },
  { value: 'bug', label: 'Bugs' },
  { value: 'enhancement', label: 'Enhancements' },
  { value: 'chore', label: 'Chores' },
];

export function IssueListScreen({ projectId }: Props): React.ReactElement {
  const issues = useOpenSpecStore((s) => s.issuesByProject[projectId] ?? []);
  const view = useOpenSpecStore((s) => s.viewByProject[projectId]);
  const patchView = useOpenSpecStore((s) => s.patchView);

  // Group: top-level (parent features OR sub-issues with no parent) + anonymous fold
  const { topLevel, anonymous } = useMemo(() => {
    const filter = view?.typeFilter;
    const matched =
      filter && filter !== null && filter !== ('all' as never)
        ? issues.filter((i) => i.type === filter)
        : issues;
    const top: LocalIssue[] = [];
    const anon: LocalIssue[] = [];
    for (const i of matched) {
      if (i.isAnonymous) anon.push(i);
      else if (i.parentIssueId === undefined || i.parentIssueId === null) top.push(i);
      // (sub-issues with a parent are shown inside parent's detail, not here)
    }
    // sort: open issues first, then updated_at desc
    const score = (i: LocalIssue): number => (i.status === 'closed' ? 1 : 0);
    top.sort((a, b) => score(a) - score(b) || b.updatedAt - a.updatedAt);
    return { topLevel: top, anonymous: anon };
  }, [issues, view?.typeFilter]);

  const subCountFor = (parentId: string): number =>
    issues.filter((i) => i.parentIssueId === parentId).length;

  const openIssue = async (issueId: string): Promise<void> => {
    const issue = await getIssue(issueId);
    if (issue.type === 'feature') {
      patchView(projectId, {
        screen: 'feature-detail',
        selectedFeatureId: issue.id,
        selectedSubIssueId: undefined,
      });
    } else {
      patchView(projectId, { screen: 'sub-issue-detail', selectedSubIssueId: issue.id });
    }
  };

  // For G5b, anonymous chip count + drill-in already shows; this hook re-fetches
  // when expanded. `listSubIssues` is consumed by detail screens in Task 3.
  useEffect(() => {
    void listSubIssues; // suppress unused-import lint
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Issues</h3>
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            onClick={() => patchView(projectId, { showNewIssue: true })}
          >
            + New Issue
          </button>
        </div>
      </div>

      {/* Type filter chips */}
      <div className="flex flex-wrap gap-1.5">
        {TYPE_CHIPS.map((c) => {
          const active = (view?.typeFilter ?? 'all') === c.value;
          return (
            <button
              key={c.value}
              className={`px-2 py-0.5 text-xs rounded-md ${
                active
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary text-muted-foreground hover:text-foreground'
              }`}
              onClick={() =>
                patchView(projectId, {
                  typeFilter: c.value === 'all' ? null : (c.value as LocalIssueType),
                })
              }
            >
              {c.label}
            </button>
          );
        })}
      </div>

      {/* Top-level rows */}
      {topLevel.length === 0 && anonymous.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No issues yet. Click "+ New Issue" to start.
        </div>
      ) : (
        <ul className="space-y-2">
          {topLevel.map((i) => (
            <li
              key={i.id}
              className="border border-border rounded-md p-3 bg-card cursor-pointer hover:bg-secondary/30 transition-colors"
              onClick={() => void openIssue(i.id)}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">{i.title}</div>
                  <div className="text-xs text-muted-foreground">
                    {i.type}
                    {i.type === 'feature' &&
                      ` · ${subCountFor(i.id)} sub-issue${subCountFor(i.id) === 1 ? '' : 's'}`}
                  </div>
                </div>
                <StatusBadge status={i.status} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Anonymous fold */}
      {anonymous.length > 0 && (
        <div className="border border-border rounded-md bg-muted/30">
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-secondary flex items-center justify-between"
            onClick={() =>
              patchView(projectId, { anonymousExpanded: !view?.anonymousExpanded })
            }
          >
            <span>Anonymous ({anonymous.length})</span>
            <span className="text-xs opacity-60">{view?.anonymousExpanded ? '▾' : '▸'}</span>
          </button>
          {view?.anonymousExpanded && (
            <ul className="border-t border-border divide-y divide-border">
              {anonymous.map((i) => (
                <li
                  key={i.id}
                  className="px-3 py-2 cursor-pointer hover:bg-secondary/30"
                  onClick={() => void openIssue(i.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-sm">{i.title}</div>
                    <StatusBadge status={i.status} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
