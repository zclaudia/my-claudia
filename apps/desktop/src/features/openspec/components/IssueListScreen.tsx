// apps/desktop/src/features/openspec/components/IssueListScreen.tsx
//
// Top-level Spec view. Shows:
// - Epics list (C5 — extracted from feature-type LocalIssue)
// - Standalone LocalIssues (no epicId)
// - Folded "Anonymous (N)" section
// - Type filter chips
// - "+ New" entry (Epic or Sub-Issue, via NewIssueDialog)

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { LocalIssue, LocalIssueType } from '@my-claudia/shared/features/local-issue';
import type { Epic } from '@my-claudia/shared/features/epic';
import { useOpenSpecStore } from '../store.js';
import { listIssues, listEpics, getIssue } from '../api.js';
import { IssueStatusBadge, StatusBadge } from './StatusBadge.js';

interface Props {
  projectId: string;
}

const TYPE_CHIPS: { value: LocalIssueType | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'implement', label: 'Changes' },
  { value: 'bug', label: 'Bugs' },
  { value: 'enhancement', label: 'Enhancements' },
  { value: 'chore', label: 'Chores' },
];

export function IssueListScreen({ projectId }: Props): React.ReactElement {
  const issues = useOpenSpecStore((s) => s.issuesByProject[projectId] ?? []);
  const view = useOpenSpecStore((s) => s.viewByProject[projectId]);
  const patchView = useOpenSpecStore((s) => s.patchView);
  const setIssues = useOpenSpecStore((s) => s.setIssues);
  const [epics, setEpics] = useState<Epic[]>([]);

  // Group: standalone issues (no epicId) + anonymous fold.
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
      else if (i.epicId === undefined || i.epicId === null) top.push(i);
      // (sub-issues with an Epic are shown inside the Epic detail screen)
    }
    const score = (i: LocalIssue): number => (i.status === 'closed' ? 1 : 0);
    top.sort((a, b) => score(a) - score(b) || b.updatedAt - a.updatedAt);
    return { topLevel: top, anonymous: anon };
  }, [issues, view?.typeFilter]);

  const issueCountForEpic = (epicId: string): number =>
    issues.filter((i) => i.epicId === epicId).length;

  const openIssue = async (issueId: string): Promise<void> => {
    const issue = await getIssue(issueId);
    patchView(projectId, { screen: 'sub-issue-detail', selectedSubIssueId: issue.id });
  };

  const openEpic = (epicId: string): void => {
    patchView(projectId, {
      screen: 'epic-detail',
      selectedEpicId: epicId,
      selectedSubIssueId: undefined,
    });
  };

  const refresh = useCallback((): void => {
    listIssues(projectId)
      .then((rows) => setIssues(projectId, rows))
      .catch((e) => console.error('[openspec] listIssues failed', e));
    listEpics(projectId)
      .then(setEpics)
      .catch((e) => console.error('[openspec] listEpics failed', e));
  }, [projectId, setIssues]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Issues</h3>
        <div className="flex items-center gap-2">
          <button
            className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            onClick={() => patchView(projectId, { screen: 'corpus' })}
          >
            📚 Spec Corpus
          </button>
          <button
            className="px-2 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            onClick={refresh}
            title="Refresh"
          >
            ↻
          </button>
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

      {/* Epics */}
      {epics.length > 0 && (
        <div className="space-y-2">
          <div className="text-xs font-semibold uppercase text-muted-foreground">Epics</div>
          <ul className="space-y-2">
            {epics.map((e) => (
              <li
                key={e.id}
                className="border border-border rounded-md p-3 bg-card cursor-pointer hover:bg-secondary/30 transition-colors"
                onClick={() => openEpic(e.id)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-medium text-sm">{e.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {`epic · ${issueCountForEpic(e.id)} issue${issueCountForEpic(e.id) === 1 ? '' : 's'}`}
                    </div>
                  </div>
                  <StatusBadge status={e.status} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Standalone issues */}
      {topLevel.length === 0 && anonymous.length === 0 && epics.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No issues yet. Click "+ New Issue" to start.
        </div>
      ) : topLevel.length > 0 && (
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
                  <div className="text-xs text-muted-foreground">{i.type}</div>
                </div>
                <IssueStatusBadge issue={i} />
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
            <>
              <ul className="border-t border-border divide-y divide-border">
                {anonymous.map((i) => (
                  <li
                    key={i.id}
                    className="px-3 py-2 cursor-pointer hover:bg-secondary/30"
                    onClick={() => void openIssue(i.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm">{i.title}</div>
                      <IssueStatusBadge issue={i} />
                    </div>
                  </li>
                ))}
              </ul>
              <div className="px-3 py-1.5 text-right border-t border-border">
                <button
                  className="text-xs text-primary hover:underline"
                  onClick={() =>
                    patchView(projectId, { screen: 'anonymous-management' })
                  }
                >
                  Manage Anonymous Issues →
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
