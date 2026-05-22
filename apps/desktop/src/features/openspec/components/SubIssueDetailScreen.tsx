// apps/desktop/src/features/openspec/components/SubIssueDetailScreen.tsx
//
// Sub-issue detail view. Shows breadcrumb (Issues / parent feature / current),
// title + status, status transition buttons (open → planning → tasks_ready →
// executing → reviewing → Close & Archive), a spec_change card placeholder
// (replaced with real artifact tabs in Task 4), and an executor section with
// create/start/cancel/mark-completed controls.

import React, { useEffect, useState } from 'react';
import type { ExecutorInstance } from '@my-claudia/shared/features/executor';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import { StatusBadge } from './StatusBadge.js';

interface Props {
  projectId: string;
  subIssueId: string;
}

export function SubIssueDetailScreen({
  projectId,
  subIssueId,
}: Props): React.ReactElement {
  const issue = useOpenSpecStore((s) =>
    (s.issuesByProject[projectId] ?? []).find((i) => i.id === subIssueId),
  );
  const specChange = useOpenSpecStore((s) =>
    issue?.specChangeId ? s.specChangesById[issue.specChangeId] : undefined,
  );
  const executors = useOpenSpecStore((s) =>
    issue?.specChangeId ? (s.executorsBySpecChange[issue.specChangeId] ?? []) : [],
  );
  const patchView = useOpenSpecStore((s) => s.patchView);
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);
  const setSpecChange = useOpenSpecStore((s) => s.setSpecChange);
  const setExecutors = useOpenSpecStore((s) => s.setExecutors);
  const upsertExecutor = useOpenSpecStore((s) => s.upsertExecutor);
  const [busy, setBusy] = useState<string | null>(null);

  const specChangeId = issue?.specChangeId;

  useEffect(() => {
    if (!specChangeId) return;
    void api.getSpecChange(specChangeId).then(setSpecChange).catch(() => undefined);
    void api
      .listExecutors(specChangeId)
      .then((list) => setExecutors(specChangeId, list))
      .catch(() => undefined);
  }, [specChangeId, setSpecChange, setExecutors]);

  if (!issue) {
    return (
      <div className="p-4">
        <button
          className="text-sm text-primary hover:underline"
          onClick={() =>
            patchView(projectId, { screen: 'issues', selectedSubIssueId: undefined })
          }
        >
          ← Back to Issues
        </button>
        <div className="mt-2 text-sm text-muted-foreground">Sub-Issue not found.</div>
      </div>
    );
  }

  const onTransition = async (
    status: 'planning' | 'tasks_ready' | 'executing' | 'reviewing',
  ): Promise<void> => {
    setBusy(`status:${status}`);
    try {
      const updated = await api.transitionStatus(issue.id, status);
      upsertIssue(updated);
    } catch (e) {
      alert(`Transition failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onCloseAndArchive = (): void => {
    patchView(projectId, { showArchiveConfirm: true });
  };

  const onCreateManualExecutor = async (): Promise<void> => {
    if (!issue.specChangeId) return;
    setBusy('exec-create');
    try {
      const inst = await api.createExecutor({
        projectId,
        specChangeId: issue.specChangeId,
        type: 'manual',
      });
      upsertExecutor(inst);
    } catch (e) {
      alert(`Create executor failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const doExecAction = async (
    inst: ExecutorInstance,
    fn: (id: string) => Promise<ExecutorInstance>,
    label: string,
  ): Promise<void> => {
    setBusy(`exec:${inst.id}:${label}`);
    try {
      const updated = await fn(inst.id);
      upsertExecutor(updated);
    } catch (e) {
      alert(`${label} failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <nav className="text-sm text-muted-foreground flex items-center gap-2">
        <button
          className="text-primary hover:underline"
          onClick={() =>
            patchView(projectId, { screen: 'issues', selectedSubIssueId: undefined })
          }
        >
          ← Issues
        </button>
        {issue.parentIssueId && (
          <>
            <span>/</span>
            <button
              className="text-primary hover:underline"
              onClick={() =>
                patchView(projectId, {
                  screen: 'feature-detail',
                  selectedFeatureId: issue.parentIssueId,
                  selectedSubIssueId: undefined,
                })
              }
            >
              {issue.parentIssueId.slice(0, 8)}
            </button>
          </>
        )}
        <span>/</span>
        <span className="font-medium text-foreground">{issue.title}</span>
      </nav>

      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xl font-semibold">{issue.title}</h3>
          <div className="text-sm text-muted-foreground">
            {issue.type}
            {issue.isAnonymous ? ' · anonymous' : ''}
          </div>
        </div>
        <StatusBadge status={issue.status} />
      </div>

      {/* Status transition controls */}
      <div className="flex flex-wrap gap-2">
        {issue.status === 'open' && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            disabled={busy !== null}
            onClick={() => void onTransition('planning')}
          >
            → planning
          </button>
        )}
        {issue.status === 'planning' && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            disabled={busy !== null}
            onClick={() => void onTransition('tasks_ready')}
          >
            → tasks_ready
          </button>
        )}
        {issue.status === 'tasks_ready' && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            disabled={busy !== null}
            onClick={() => void onTransition('executing')}
          >
            → executing
          </button>
        )}
        {issue.status === 'executing' && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            disabled={busy !== null}
            onClick={() => void onTransition('reviewing')}
          >
            → reviewing
          </button>
        )}
        {issue.status === 'reviewing' && (
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            disabled={busy !== null}
            onClick={onCloseAndArchive}
          >
            Close & Archive
          </button>
        )}
      </div>

      {/* Spec Change artifact tabs (body filled in Task 4) */}
      {specChange && (
        <div className="border border-border rounded-md bg-card">
          <div className="px-3 py-2 border-b border-border text-sm font-medium">
            Spec Change{' '}
            <code className="ml-1 px-1 py-0.5 rounded bg-muted font-mono text-xs">
              {specChange.slug}
            </code>{' '}
            · <StatusBadge status={'planning' as never} />
            {/* showing spec_change status would need its own badge — left as-is */}
          </div>
          <div className="px-3 py-3 text-sm text-muted-foreground">
            Artifact tabs (proposal / design / tasks / delta) land in Task 4.
          </div>
        </div>
      )}

      {/* Executors */}
      <div className="border border-border rounded-md bg-card">
        <div className="px-3 py-2 border-b border-border flex items-center justify-between">
          <span className="text-sm font-medium">Executors</span>
          <button
            className="px-2.5 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            onClick={() => void onCreateManualExecutor()}
          >
            + Manual Executor
          </button>
        </div>
        {executors.length === 0 ? (
          <div className="px-3 py-3 text-sm text-muted-foreground">No executors yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {executors.map((e) => (
              <li
                key={e.id}
                className="px-3 py-2 flex items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono">{e.type}</span>
                  <span className="text-xs text-muted-foreground">{e.id.slice(0, 8)}</span>
                  <StatusBadge status={e.statusSummary} />
                </div>
                <div className="flex items-center gap-1">
                  {e.statusSummary === 'pending' && (
                    <button
                      className="px-2 py-0.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                      disabled={busy !== null}
                      onClick={() => void doExecAction(e, api.startExecutor, 'start')}
                    >
                      Start
                    </button>
                  )}
                  {e.statusSummary === 'executing' && e.type === 'manual' && (
                    <button
                      className="px-2 py-0.5 text-xs rounded-md bg-green-500/15 text-green-600 hover:bg-green-500/25"
                      disabled={busy !== null}
                      onClick={() => void doExecAction(e, api.completeExecutor, 'complete')}
                    >
                      Mark Completed
                    </button>
                  )}
                  {(e.statusSummary === 'pending' ||
                    e.statusSummary === 'executing' ||
                    e.statusSummary === 'paused') && (
                    <button
                      className="px-2 py-0.5 text-xs rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25"
                      disabled={busy !== null}
                      onClick={() => void doExecAction(e, api.cancelExecutor, 'cancel')}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
