// apps/desktop/src/features/meta-workflow/components/PromotionDialog.tsx
import React, { useState } from 'react';
import type { MetaWorkflowRun } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';
import * as api from '../api.js';

interface Props {
  projectId: string;
  run: MetaWorkflowRun;
  poolItemId?: string;
  socket: { send: (msg: string) => void };
}

export function PromotionDialog({ projectId, run, poolItemId, socket: _socket }: Props): React.ReactElement {
  const patchView = useMetaWorkflowStore((s) => s.patchView);
  const [tagsInput, setTagsInput] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!poolItemId) {
    return (
      <div>
        <button className="text-sm text-primary hover:underline"
                onClick={() => patchView(projectId, { screen: 'phase-board', promotingPoolItemId: undefined })}>
          ← Close
        </button>
        <div className="text-muted-foreground mt-2">No pool item selected for promotion.</div>
      </div>
    );
  }

  const onPromote = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await api.promotePoolItem(
        run.id,
        poolItemId,
        tagsInput.split(',').map((t) => t.trim()).filter(Boolean),
        name || undefined,
        description || undefined,
      );
      patchView(projectId, { screen: 'phase-board', promotingPoolItemId: undefined });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg space-y-3">
      <h3 className="text-lg font-semibold">Promote Reusable Pool Item</h3>
      <div className="text-sm text-muted-foreground">Item: <code className="px-1 py-0.5 bg-muted rounded">{poolItemId}</code></div>

      <div>
        <label className="block text-sm font-medium mb-1">New tags (comma-separated)</label>
        <input type="text" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
               value={tagsInput} onChange={(e) => setTagsInput(e.target.value)}
               placeholder="my-template, jpa-impl" />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">New name (optional)</label>
        <input type="text" className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
               value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">New description (optional)</label>
        <textarea className="w-full bg-background border border-border rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                  value={description} onChange={(e) => setDescription(e.target.value)} rows={3} />
      </div>

      {error && <div className="text-sm text-red-500">Error: {error}</div>}

      <div className="flex gap-2">
        <button className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                disabled={submitting}
                onClick={onPromote}>
          {submitting ? 'Promoting…' : 'Promote'}
        </button>
        <button className="px-3 py-1.5 text-sm rounded-md bg-secondary hover:bg-secondary/80"
                onClick={() => patchView(projectId, { screen: 'phase-board', promotingPoolItemId: undefined })}>
          Cancel
        </button>
      </div>
    </div>
  );
}
