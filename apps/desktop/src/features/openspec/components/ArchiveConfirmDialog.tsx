// apps/desktop/src/features/openspec/components/ArchiveConfirmDialog.tsx
//
// Modal that confirms the close-and-archive action for a sub-issue. Shows the
// delta capability paths from the linked spec_change so the user understands
// which corpus capabilities will be merged. On confirm calls
// `api.closeAndArchive`, upserts the returned issue, and either closes or
// switches to a success state (Done button).

import React, { useState } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import type { ArchiveOutcome } from '../api.js';

interface Props {
  projectId: string;
  subIssueId: string;
  onClose: () => void;
}

export function ArchiveConfirmDialog({
  projectId,
  subIssueId,
  onClose,
}: Props): React.ReactElement {
  const issue = useOpenSpecStore((s) =>
    (s.issuesByProject[projectId] ?? []).find((i) => i.id === subIssueId),
  );
  const specChange = useOpenSpecStore((s) =>
    issue?.specChangeId ? s.specChangesById[issue.specChangeId] : undefined,
  );
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ArchiveOutcome | null>(null);
  const [errors, setErrors] = useState<{ capability: string; issues: string[] }[]>([]);

  const deltaCaps = (specChange?.deltaSpecPaths ?? [])
    .map((p) => p.split('/').slice(-2, -1)[0])
    .filter(Boolean) as string[];

  const onConfirm = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.closeAndArchive(subIssueId);
      upsertIssue(res.issue);
      if (
        res.archive &&
        res.archive.ok === false &&
        res.archive.validationErrors &&
        res.archive.validationErrors.length > 0
      ) {
        // Validation failed — surface per-capability issues and keep the dialog
        // open so the user can fix the deltas and retry.
        setErrors(res.archive.validationErrors);
        setResult(null);
      } else {
        setErrors([]);
        setResult(res.archive ?? { ok: true });
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-popover border border-border rounded-xl shadow-lg max-w-lg w-full">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-base font-semibold">Close & Archive Sub-Issue</h3>
        </div>
        <div className="px-4 py-3 space-y-3 text-sm">
          {issue ? (
            <>
              <div>
                Closing <span className="font-medium">{issue.title}</span> will:
              </div>
              <ul className="list-disc pl-6 space-y-1 text-muted-foreground">
                <li>
                  Validate {deltaCaps.length} delta capabilities:{' '}
                  {deltaCaps.length === 0
                    ? '(none)'
                    : deltaCaps.map((c) => (
                        <code
                          key={c}
                          className="mx-0.5 px-1 py-0.5 rounded bg-muted font-mono text-xs"
                        >
                          {c}
                        </code>
                      ))}
                </li>
                <li>
                  Merge those deltas into{' '}
                  <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">
                    openspec/specs/
                  </code>
                </li>
                <li>
                  Move{' '}
                  <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">
                    openspec/changes/{specChange?.slug ?? '?'}/
                  </code>{' '}
                  to{' '}
                  <code className="px-1 py-0.5 rounded bg-muted font-mono text-xs">archive/</code>
                </li>
              </ul>
              {error && <div className="text-xs text-red-500">Error: {error}</div>}
              {errors.length > 0 && (
                <div className="border border-red-500/30 bg-red-500/10 rounded-md p-3 text-sm">
                  <div className="font-medium text-red-600 mb-2">
                    Validation failed — fix these before archiving:
                  </div>
                  {errors.map((capErr) => (
                    <div key={capErr.capability} className="mb-2 last:mb-0">
                      <div className="text-xs font-mono">{capErr.capability}</div>
                      <ul className="list-disc pl-5 mt-1 space-y-0.5 text-xs text-muted-foreground">
                        {capErr.issues.map((iss, idx) => (
                          <li key={idx}>{iss}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
              {result !== null && (
                <div className="text-xs text-green-600">Archive complete.</div>
              )}
            </>
          ) : (
            <div className="text-muted-foreground">Issue not found.</div>
          )}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80"
            onClick={onClose}
          >
            {result !== null ? 'Done' : 'Cancel'}
          </button>
          {result === null && (
            <button
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={busy || !issue}
              onClick={() => void onConfirm()}
            >
              {busy ? 'Archiving…' : 'Close & Archive'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
