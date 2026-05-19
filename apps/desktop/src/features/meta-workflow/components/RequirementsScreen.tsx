// apps/desktop/src/features/meta-workflow/components/RequirementsScreen.tsx
import React, { useState } from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import {
  sendSubmitRequirements,
  sendResolveRequirements,
} from '../api.js';
import { useMetaWorkflowStore } from '../store.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  socket: { send: (msg: string) => void };
}

export function RequirementsScreen({ projectId, run, socket }: Props): React.ReactElement {
  const [path, setPath] = useState(run.requirementsPath ?? 'design/requirements.md');
  const patchView = useMetaWorkflowStore((s) => s.patchView);

  const isReview = run.status === 'requirement_review';
  const isDraft = run.status === 'requirement_draft';
  const approachingEscape = run.rejectCount >= 4;

  return (
    <div className="space-y-4 max-w-2xl">
      <h3 className="text-lg font-semibold">Requirements — {run.title}</h3>
      <div className="text-sm text-muted-foreground">Status: <span className="font-mono text-foreground">{run.status}</span></div>

      {approachingEscape && (
        <div className="border border-yellow-500/30 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 p-3 rounded-md text-sm">
          ⚠ Reject count: {run.rejectCount}. After the next reject the escape hatch (direct edit) becomes available.
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium">Requirements document path</label>
        <input
          type="text"
          className="w-full bg-background border border-border rounded-md px-3 py-2 font-mono text-sm focus:outline-none focus:ring-1 focus:ring-primary/50 disabled:opacity-60"
          value={path}
          disabled={!isDraft}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        {isDraft && (
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={() => sendSubmitRequirements(socket, { runId: run.id, requirementsPath: path })}
          >
            Submit Requirements
          </button>
        )}
        {isReview && (
          <>
            <button
              className="px-3 py-1.5 text-sm rounded-md bg-green-500/15 text-green-600 hover:bg-green-500/25"
              onClick={() => {
                sendResolveRequirements(socket, { runId: run.id, decision: 'approve' });
                patchView(projectId, { screen: 'phase-graph' });
              }}
            >
              Approve
            </button>
            <button
              className="px-3 py-1.5 text-sm rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25"
              onClick={() => sendResolveRequirements(socket, { runId: run.id, decision: 'reject' })}
            >
              Reject
            </button>
          </>
        )}
      </div>
    </div>
  );
}
