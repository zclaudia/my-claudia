// apps/desktop/src/features/openspec/components/NewIssueDialog.tsx
//
// Modal for creating a new issue. Two flavors driven by `parentFeatureId`:
//   - No parent → user picks between `feature` (organizational container) or
//     a standalone non-feature type (creates an anonymous-style sub-issue).
//   - Parent set → type is constrained to non-feature kinds; the resulting
//     sub-issue is linked to the parent feature.
//
// On submit, the dialog routes to `createFeature` or `createSubIssue`,
// upserts the returned issue (and spec_change, where applicable) into the
// store, then closes.

import React, { useState } from 'react';
import type { LocalIssueType } from '@my-claudia/shared/features/local-issue';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

interface Props {
  projectId: string;
  /** Pre-fills parentIssueId — if set, the type is forced to non-feature. */
  parentFeatureId?: string;
  onClose: () => void;
}

const SUB_TYPES: { value: Exclude<LocalIssueType, 'feature'>; label: string }[] = [
  { value: 'implement', label: 'Implement' },
  { value: 'bug', label: 'Bug' },
  { value: 'enhancement', label: 'Enhancement' },
  { value: 'chore', label: 'Chore' },
];

export function NewIssueDialog({
  projectId,
  parentFeatureId,
  onClose,
}: Props): React.ReactElement {
  const upsertIssue = useOpenSpecStore((s) => s.upsertIssue);
  const setSpecChange = useOpenSpecStore((s) => s.setSpecChange);
  const [type, setType] = useState<LocalIssueType>(parentFeatureId ? 'implement' : 'feature');
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (): Promise<void> => {
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      if (type === 'feature') {
        const issue = await api.createFeature({ projectId, title: title.trim() });
        upsertIssue(issue);
      } else {
        const { issue, specChange } = await api.createSubIssue({
          projectId,
          type,
          title: title.trim(),
          parentIssueId: parentFeatureId,
        });
        upsertIssue(issue);
        setSpecChange(specChange);
      }
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-popover border border-border rounded-xl shadow-lg max-w-md w-full">
        <div className="px-4 py-3 border-b border-border">
          <h3 className="text-base font-semibold">New Issue</h3>
        </div>
        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Type</label>
            {parentFeatureId ? (
              <select
                className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm"
                value={type as string}
                onChange={(e) => setType(e.target.value as LocalIssueType)}
              >
                {SUB_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            ) : (
              <select
                className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm"
                value={type as string}
                onChange={(e) => setType(e.target.value as LocalIssueType)}
              >
                <option value="feature">Feature (organizational container)</option>
                {SUB_TYPES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label} (standalone)
                  </option>
                ))}
              </select>
            )}
          </div>
          <div>
            <label className="block text-xs text-muted-foreground mb-1">Title</label>
            <input
              type="text"
              className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={type === 'feature' ? 'Feature title' : 'Change title'}
              autoFocus
            />
          </div>
          {error && <div className="text-xs text-red-500">Error: {error}</div>}
        </div>
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={busy || !title.trim()}
            onClick={() => void onSubmit()}
          >
            {busy ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}
