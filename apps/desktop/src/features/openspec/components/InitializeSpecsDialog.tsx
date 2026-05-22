// apps/desktop/src/features/openspec/components/InitializeSpecsDialog.tsx
//
// Modal that drives a bootstrap scan end-to-end:
//   1. On mount, POST /api/openspec/bootstrap/scans with `mode`.
//   2. Show the auto-applied summary and any pending review items.
//   3. Allow approve/reject per pending item.
//   4. Finalize once all items are resolved → refresh corpus → close.
//
// `payloadJson` is a raw JSON string from the server; we parse it defensively
// to render a friendly preview (falls back to a truncated raw view on error).

import React, { useEffect, useState } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import type { BootstrapScan, BootstrapReviewItem } from '../api.js';

interface Props {
  projectId: string;
  mode: 'initial' | 'rescan';
  onClose: () => void;
}

export function InitializeSpecsDialog({
  projectId,
  mode,
  onClose,
}: Props): React.ReactElement {
  const setCorpus = useOpenSpecStore((s) => s.setCorpus);
  const [scan, setScan] = useState<BootstrapScan | null>(null);
  const [items, setItems] = useState<BootstrapReviewItem[]>([]);
  const [appliedSummary, setAppliedSummary] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy('start');
    setError(null);
    api
      .startBootstrap(projectId, mode)
      .then(async (res) => {
        if (cancelled) return;
        setScan(res.scan);
        setAppliedSummary(res.appliedSummary);
        if (res.scan.status === 'awaiting_review') {
          const pending = await api.listBootstrapItems(res.scan.id, 'pending');
          if (!cancelled) setItems(pending);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setBusy(null);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, mode]);

  const onApprove = async (id: string): Promise<void> => {
    setBusy(`approve:${id}`);
    setError(null);
    try {
      await api.approveBootstrapItem(id);
      if (scan) setItems(await api.listBootstrapItems(scan.id, 'pending'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onReject = async (id: string): Promise<void> => {
    setBusy(`reject:${id}`);
    setError(null);
    try {
      await api.rejectBootstrapItem(id);
      if (scan) setItems(await api.listBootstrapItems(scan.id, 'pending'));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onFinalize = async (): Promise<void> => {
    if (!scan) return;
    setBusy('finalize');
    setError(null);
    try {
      await api.finalizeBootstrap(scan.id);
      const fresh = await api.listCorpus(projectId);
      setCorpus(projectId, fresh);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-popover border border-border rounded-xl shadow-lg max-w-2xl w-full max-h-[80vh] flex flex-col">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <h3 className="text-base font-semibold">
            {mode === 'initial' ? 'Initialize Specs' : 'Re-scan Specs'}
          </h3>
          <button
            className="text-xs text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="flex-1 overflow-auto px-4 py-3 space-y-3">
          {error && <div className="text-sm text-red-500">Error: {error}</div>}

          {!scan && busy === 'start' && (
            <div className="text-sm text-muted-foreground">
              Scanning project… AI is analyzing the codebase.
            </div>
          )}

          {scan && (
            <>
              <div className="text-sm">
                <div>
                  Scan status: <span className="font-mono">{scan.status}</span>
                </div>
                <div className="text-muted-foreground text-xs mt-1">
                  Applied {scan.appliedCount} requirement
                  {scan.appliedCount === 1 ? '' : 's'} automatically (ADDED).
                  {scan.pendingCount > 0 &&
                    ` ${scan.pendingCount} item${scan.pendingCount === 1 ? '' : 's'} pending review.`}
                </div>
              </div>

              {Object.keys(appliedSummary).length > 0 && (
                <div className="border border-border rounded-md p-3 bg-muted/30 text-xs">
                  <div className="font-medium mb-1">Auto-applied per capability</div>
                  <ul className="space-y-0.5">
                    {Object.entries(appliedSummary).map(([cap, count]) => (
                      <li key={cap}>
                        {cap}: +{count}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {items.length > 0 && (
                <div>
                  <div className="text-sm font-medium mb-2">
                    Pending review ({items.length})
                  </div>
                  <ul className="space-y-2">
                    {items.map((it) => {
                      let preview = '';
                      try {
                        const obj = JSON.parse(it.payloadJson) as {
                          name?: string;
                          body?: string;
                        };
                        preview = obj.name
                          ? `${obj.name}${obj.body ? ' — ' + obj.body.slice(0, 80) : ''}`
                          : it.payloadJson.slice(0, 120);
                      } catch {
                        preview = it.payloadJson.slice(0, 120);
                      }
                      return (
                        <li
                          key={it.id}
                          className="border border-border rounded-md p-2 bg-card"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-xs">
                              <span className="font-mono">{it.capability}</span> ·{' '}
                              <span className="text-muted-foreground">{it.operation}</span>
                            </div>
                            <div className="flex gap-1">
                              <button
                                className="px-2 py-0.5 text-xs rounded-md bg-green-500/15 text-green-600 hover:bg-green-500/25"
                                disabled={busy !== null}
                                onClick={() => void onApprove(it.id)}
                              >
                                Approve
                              </button>
                              <button
                                className="px-2 py-0.5 text-xs rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25"
                                disabled={busy !== null}
                                onClick={() => void onReject(it.id)}
                              >
                                Reject
                              </button>
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">{preview}</div>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          {scan && scan.status === 'awaiting_review' && (
            <button
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={busy !== null || items.length > 0}
              title={items.length > 0 ? 'Resolve all pending items first' : 'Finalize'}
              onClick={() => void onFinalize()}
            >
              Finalize
            </button>
          )}
          {scan && scan.status === 'completed' && (
            <button
              className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={onClose}
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
