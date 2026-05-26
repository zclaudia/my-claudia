// apps/desktop/src/features/openspec/components/LegacyRescanView.tsx
//
// Self-contained rescan-path UI extracted from the pre-multi-step
// InitializeSpecsDialog. Loads its own scan + pending review items via the
// REST API (no Zustand store, except `setCorpus` which it calls after a
// successful finalize so the surrounding screen reflects the merged corpus).
//
// Render branches by scan status:
//   - awaiting_review: list pending modify/remove items with approve/reject,
//     Finalize button enabled once all items are resolved.
//   - running:         show a stuck-scan hint + Cancel button.
//   - completed:       show "scan complete" + Done button.
//   - cancelled:       show "scan cancelled" notice.
//   - failed:          show error message.

import React, { useEffect, useState } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import type { BootstrapScan, BootstrapReviewItem } from '../api.js';

interface Props {
  scanId: string;
  onClose: () => void;
}

export function LegacyRescanView({ scanId, onClose }: Props): React.ReactElement {
  const setCorpus = useOpenSpecStore((s) => s.setCorpus);
  const [scan, setScan] = useState<BootstrapScan | null>(null);
  const [items, setItems] = useState<BootstrapReviewItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setBusy('load');
    setError(null);
    (async () => {
      try {
        const fresh = await api.getBootstrapScan(scanId);
        if (cancelled) return;
        setScan(fresh);
        if (fresh.status === 'awaiting_review') {
          const pending = await api.listBootstrapItems(scanId, 'pending');
          if (!cancelled) setItems(pending);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setBusy(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scanId]);

  const refreshItems = async (): Promise<void> => {
    const pending = await api.listBootstrapItems(scanId, 'pending');
    setItems(pending);
  };

  const onApprove = async (id: string): Promise<void> => {
    setBusy(`approve:${id}`);
    setError(null);
    try {
      await api.approveBootstrapItem(id);
      await refreshItems();
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
      await refreshItems();
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
      const fresh = await api.listCorpus(scan.projectId);
      setCorpus(scan.projectId, fresh);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const onCancelScan = async (): Promise<void> => {
    if (!scan) return;
    setBusy('cancel');
    setError(null);
    try {
      await api.cancelBootstrapScan(scan.id);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  if (busy === 'load' && !scan) {
    return <div className="text-sm text-muted-foreground">Loading scan…</div>;
  }

  if (!scan) {
    return (
      <div className="space-y-2">
        {error && <div className="text-sm text-red-500">Error: {error}</div>}
        <div className="text-sm text-muted-foreground">Scan unavailable.</div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error && <div className="text-sm text-red-500">Error: {error}</div>}

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

      {scan.errorMessage && (
        <div className="border border-red-500/40 rounded-md p-2 bg-red-500/10 text-xs text-red-600 whitespace-pre-wrap break-words">
          {scan.errorMessage}
        </div>
      )}

      {scan.status === 'running' && (
        <div className="text-xs text-yellow-600">
          A scan is currently running. If it&apos;s stuck, cancel it to start fresh.
        </div>
      )}

      {scan.status === 'cancelled' && (
        <div className="text-sm text-muted-foreground">Scan was cancelled.</div>
      )}

      {scan.status === 'completed' &&
        scan.appliedCount === 0 &&
        scan.pendingCount === 0 &&
        !scan.errorMessage && (
          <div className="border border-amber-500/40 rounded-md p-2 bg-amber-500/10 text-xs text-amber-700">
            AI scan completed but did not extract any requirements. Make sure the project
            has a default AI provider configured and check the server log for the raw AI
            response.
          </div>
        )}

      {scan.status === 'awaiting_review' && items.length > 0 && (
        <div>
          <div className="text-sm font-medium mb-2">Pending review ({items.length})</div>
          <ul className="space-y-2">
            {items.map((it) => {
              let preview = '';
              try {
                const obj = JSON.parse(it.payloadJson) as { name?: string; body?: string };
                preview = obj.name
                  ? `${obj.name}${obj.body ? ' — ' + obj.body.slice(0, 80) : ''}`
                  : it.payloadJson.slice(0, 120);
              } catch {
                preview = it.payloadJson.slice(0, 120);
              }
              return (
                <li key={it.id} className="border border-border rounded-md p-2 bg-card">
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

      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        {scan.status === 'running' && (
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-red-500/15 text-red-500 hover:bg-red-500/25 disabled:opacity-50"
            disabled={busy !== null}
            onClick={() => void onCancelScan()}
          >
            Cancel Scan
          </button>
        )}
        {scan.status === 'awaiting_review' && (
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            disabled={busy !== null || items.length > 0}
            title={items.length > 0 ? 'Resolve all pending items first' : 'Finalize'}
            onClick={() => void onFinalize()}
          >
            Finalize
          </button>
        )}
        {scan.status === 'completed' && (
          <button
            className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={onClose}
          >
            Done
          </button>
        )}
      </div>
    </div>
  );
}
