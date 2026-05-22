// apps/desktop/src/features/openspec/components/SpecCorpusScreen.tsx
//
// Spec Corpus screen: lists capability summaries for a project with their
// requirement / scenario counts. Surfaces an "Initialize Specs" CTA when the
// corpus is empty, or "Re-scan" when it already has content; both open the
// `InitializeSpecsDialog` via the view-state flag.

import React, { useCallback, useEffect, useState } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';

interface Props {
  projectId: string;
}

export function SpecCorpusScreen({ projectId }: Props): React.ReactElement {
  const corpus = useOpenSpecStore((s) => s.corpusByProject[projectId] ?? []);
  const setCorpus = useOpenSpecStore((s) => s.setCorpus);
  const patchView = useOpenSpecStore((s) => s.patchView);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback((): void => {
    setLoading(true);
    setError(null);
    api
      .listCorpus(projectId)
      .then((items) => setCorpus(projectId, items))
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, [projectId, setCorpus]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const isEmpty = corpus.length === 0 && !loading && !error;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">📚 Spec Corpus</h3>
        <div className="flex items-center gap-2">
          <button
            className="px-2 py-1 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            onClick={refresh}
            title="Refresh"
          >
            ↻
          </button>
          <button
            className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
            onClick={() => patchView(projectId, { showInitializeSpecs: true })}
          >
            {isEmpty ? 'Initialize Specs' : 'Re-scan'}
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-red-500">Error: {error}</div>}
      {isEmpty && (
        <div className="border border-border rounded-md p-6 bg-muted/30 text-center">
          <div className="text-sm text-muted-foreground">No specs yet.</div>
          <div className="text-xs text-muted-foreground mt-1">
            Click "Initialize Specs" to scan the project and seed the corpus.
          </div>
        </div>
      )}
      {corpus.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {corpus.map((c) => (
            <li key={c.capability} className="border border-border rounded-md p-3 bg-card">
              <div className="font-medium text-sm">{c.capability}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {c.requirementCount} requirement{c.requirementCount === 1 ? '' : 's'} ·{' '}
                {c.scenarioCount} scenario{c.scenarioCount === 1 ? '' : 's'}
              </div>
              <div className="text-[10px] text-muted-foreground mt-2">
                Updated {new Date(c.lastUpdatedAt).toLocaleDateString()}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
