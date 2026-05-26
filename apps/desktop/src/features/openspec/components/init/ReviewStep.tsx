import React, { useState } from 'react';
import type { BootstrapScan, Candidate } from '../../api.js';
import * as api from '../../api.js';
import { useOpenSpecStore } from '../../store.js';
import { SpecMarkdownPreview } from './SpecMarkdownPreview.js';

interface Props { scan: BootstrapScan; onClose: () => void; }

export function ReviewStep({ scan, onClose }: Props): React.ReactElement {
  const candidates = useOpenSpecStore((s) => s.initCandidatesByScan[scan.id] ?? []);
  const upsert = useOpenSpecStore((s) => s.upsertInitCandidate);
  const [busyId, setBusyId] = useState<string | null>(null);

  const visible = candidates.filter((c) => c.selected && c.phase !== 'excluded');
  const pending = visible.filter((c) => ['generated', 'failed'].includes(c.phase));
  const approved = visible.filter((c) => c.phase === 'approved').length;
  const rejected = visible.filter((c) => c.phase === 'rejected').length;
  const failed = visible.filter((c) => c.phase === 'failed').length;

  async function doApprove(c: Candidate): Promise<void> {
    setBusyId(c.id);
    try { upsert(scan.id, await api.approveCandidate(c.id)); }
    catch (e) { console.error(e); }
    finally { setBusyId(null); }
  }
  async function doReject(c: Candidate): Promise<void> {
    setBusyId(c.id);
    try { upsert(scan.id, await api.rejectCandidate(c.id)); }
    catch (e) { console.error(e); }
    finally { setBusyId(null); }
  }
  async function doRetry(c: Candidate): Promise<void> {
    setBusyId(c.id);
    try { upsert(scan.id, await api.retryCandidate(c.id)); }
    catch (e) { console.error(e); }
    finally { setBusyId(null); }
  }
  async function doFinalize(): Promise<void> {
    await api.finalizeBootstrap(scan.id);
    onClose();
  }

  return (
    <div className="space-y-3">
      <div className="text-sm">
        Generated {visible.length} specs. Review and approve.
        <div className="text-xs text-muted-foreground">
          {approved} approved · {rejected} rejected · {failed} failed · {pending.length} pending
        </div>
      </div>
      <div className="space-y-3">
        {visible.map((c) => (
          <div key={c.id} className="border rounded p-2">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-xs">{c.capability}</span>
              <div className="flex gap-1">
                {c.phase === 'generated' && (
                  <>
                    <button
                      className="px-2 py-0.5 text-xs rounded bg-green-500/15 text-green-600"
                      disabled={busyId === c.id}
                      onClick={() => void doApprove(c)}
                    >✅ Approve</button>
                    <button
                      className="px-2 py-0.5 text-xs rounded bg-red-500/15 text-red-500"
                      disabled={busyId === c.id}
                      onClick={() => void doReject(c)}
                    >❌ Reject</button>
                  </>
                )}
                {c.phase === 'failed' && (
                  <button
                    className="px-2 py-0.5 text-xs rounded bg-yellow-500/15 text-yellow-700"
                    disabled={busyId === c.id}
                    onClick={() => void doRetry(c)}
                  >🔁 Retry</button>
                )}
                {c.phase === 'approved' && <span className="text-xs text-green-600">approved</span>}
                {c.phase === 'rejected' && <span className="text-xs text-muted-foreground">rejected</span>}
              </div>
            </div>
            {c.generated_md && <SpecMarkdownPreview md={c.generated_md} />}
            {c.error_message && <div className="text-xs text-red-500 mt-1">{c.error_message}</div>}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-end gap-2 pt-2 border-t">
        <button
          className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          disabled={pending.length > 0}
          title={pending.length > 0 ? 'Resolve all pending items first' : 'Finalize'}
          onClick={() => void doFinalize()}
        >Finalize ({approved + rejected}/{visible.length})</button>
      </div>
    </div>
  );
}
