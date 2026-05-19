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
      <div className="text-sm text-gray-600">Status: <span className="font-mono">{run.status}</span></div>

      {approachingEscape && (
        <div className="border border-yellow-400 bg-yellow-50 p-3 rounded text-sm">
          ⚠ Reject count: {run.rejectCount}. After the next reject the escape hatch (direct edit) becomes available.
        </div>
      )}

      <div className="space-y-2">
        <label className="block text-sm font-medium">Requirements document path</label>
        <input
          type="text"
          className="w-full border rounded px-3 py-2 font-mono text-sm"
          value={path}
          disabled={!isDraft}
          onChange={(e) => setPath(e.target.value)}
        />
      </div>

      <div className="flex gap-2">
        {isDraft && (
          <button
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            onClick={() => sendSubmitRequirements(socket, { runId: run.id, requirementsPath: path })}
          >
            Submit Requirements
          </button>
        )}
        {isReview && (
          <>
            <button
              className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700"
              onClick={() => {
                sendResolveRequirements(socket, { runId: run.id, decision: 'approve' });
                patchView(projectId, { screen: 'phase-graph' });
              }}
            >
              Approve
            </button>
            <button
              className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700"
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
