import React, { useEffect, useState } from 'react';
import type { BootstrapScan } from '../../api.js';
import * as api from '../../api.js';
import { useOpenSpecStore } from '../../store.js';

interface Props {
  scan: BootstrapScan;
}

// Show the "looks stuck" affordance after this many seconds of no progress.
// Real Phase 1 usually completes in 30-120s; if the dialog is still on
// 'discovering' past this mark the scan is likely orphaned (server restart
// mid-call) — let the user kick it out without dropping to SQL.
const STUCK_HINT_AFTER_MS = 30_000;

export function DiscoveringStep({ scan }: Props): React.ReactElement {
  const setInitScan = useOpenSpecStore((s) => s.setInitScan);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStuckHint, setShowStuckHint] = useState(false);

  useEffect(() => {
    const elapsedMs = Date.now() - scan.startedAt;
    if (elapsedMs >= STUCK_HINT_AFTER_MS) {
      setShowStuckHint(true);
      return;
    }
    const timer = setTimeout(
      () => setShowStuckHint(true),
      STUCK_HINT_AFTER_MS - elapsedMs,
    );
    return () => clearTimeout(timer);
  }, [scan.startedAt]);

  const cancel = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.cancelBootstrapScan(scan.id);
      setInitScan(scan.projectId, updated);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">🔍 Scanning project…</div>
      <div className="text-xs text-muted-foreground">
        AI is reading your codebase to identify capabilities. This usually takes 30 seconds to 2 minutes.
      </div>
      <div className="text-[10px] text-muted-foreground font-mono mt-2">scan {scan.id.slice(0, 8)}</div>
      {error && <div className="text-xs text-red-500 mt-1">{error}</div>}
      {showStuckHint && (
        <button
          className="text-[10px] text-muted-foreground hover:text-foreground underline mt-2 disabled:opacity-50"
          disabled={busy}
          onClick={() => void cancel()}
        >
          {busy ? 'Cancelling…' : 'Looks stuck? Cancel & start fresh'}
        </button>
      )}
    </div>
  );
}
