// apps/desktop/src/features/meta-workflow/components/ReusePoolScreen.tsx
import React, { useEffect, useState } from 'react';
import type { ReusablePoolItem } from '@my-claudia/shared/features/meta-workflow';
import { useMetaWorkflowStore } from '../store.js';
import { listReusePool } from '../api.js';

interface Props {
  projectId: string;
}

const PHASE_TYPES = [
  'code-implement',
  'code-refactor',
  'code-test-write',
  'design-doc',
  'dep-update',
  'investigation',
] as const;

export function ReusePoolScreen({ projectId }: Props): React.ReactElement {
  const view = useMetaWorkflowStore((s) => s.viewByProject[projectId]);
  const patchView = useMetaWorkflowStore((s) => s.patchView);
  const filters = view?.poolFilters ?? {};
  const [items, setItems] = useState<ReusablePoolItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    listReusePool(filters)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch((e) => { if (!cancelled) setError((e as Error).message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [filters.phaseType, filters.search]);

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">Reusable Pool</h3>
        <button
          className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
          onClick={() => patchView(projectId, { screen: 'phase-board' })}
        >
          ← Back to Board
        </button>
      </div>

      <div className="flex flex-wrap gap-2 items-end">
        <div>
          <label className="block text-xs text-muted-foreground mb-1">Phase Type</label>
          <select
            className="bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            value={filters.phaseType ?? ''}
            onChange={(e) => patchView(projectId, {
              poolFilters: { ...filters, phaseType: e.target.value || undefined },
            })}
          >
            <option value="">All</option>
            {PHASE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div className="flex-1 min-w-[200px]">
          <label className="block text-xs text-muted-foreground mb-1">Search</label>
          <input
            type="text"
            className="w-full bg-background border border-border rounded-md px-2 py-1 text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
            placeholder="tag, description, entity id…"
            value={filters.search ?? ''}
            onChange={(e) => patchView(projectId, {
              poolFilters: { ...filters, search: e.target.value || undefined },
            })}
          />
        </div>
      </div>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}
      {error && <div className="text-sm text-red-500">Error: {error}</div>}
      {!loading && !error && items && items.length === 0 && (
        <div className="text-sm text-muted-foreground">No items match the current filters.</div>
      )}
      {!loading && items && items.length > 0 && (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {items.map((it) => (
            <li
              key={it.id}
              className="border border-border rounded-md p-3 bg-card hover:bg-secondary/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-medium text-sm">
                    {it.kind} · <span className="font-mono text-xs">{it.entityId}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {it.phaseType} · {it.sourceType}{' '}
                    {(it.metadata?.usageCount ?? 0) > 0 && (
                      <span>· used {it.metadata?.usageCount}×</span>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(it.createdAt).toLocaleDateString()}
                </span>
              </div>
              {it.description && (
                <p className="text-xs mt-2 text-muted-foreground line-clamp-2">{it.description}</p>
              )}
              {it.tags && it.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2">
                  {it.tags.map((t) => (
                    <span key={t} className="px-1.5 py-0.5 text-[10px] rounded bg-secondary text-foreground">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
