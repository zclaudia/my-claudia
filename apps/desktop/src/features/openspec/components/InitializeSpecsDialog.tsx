// apps/desktop/src/features/openspec/components/InitializeSpecsDialog.tsx
//
// Multi-step router driven by `scan.initPhase`. The dialog is intentionally
// "dumb" — it just maps the server-derived (status, initPhase) tuple onto a
// step name and renders the matching child component from ./init/. The child
// components own their own step-specific UI, network calls, and transitions.
//
// On mount we either resume an active scan (loading candidates if we're past
// the discovering phase) or kick off a fresh bootstrap. The "scan already
// active" race surfaced by the server is handled by refetching once.

import React, { useEffect } from 'react';
import { useOpenSpecStore } from '../store.js';
import * as api from '../api.js';
import type { BootstrapScan } from '../api.js';
import { DiscoveringStep } from './init/DiscoveringStep.js';
import { CapabilityPicker } from './init/CapabilityPicker.js';
import { GeneratingStep } from './init/GeneratingStep.js';
import { ReviewStep } from './init/ReviewStep.js';
import { LegacyRescanView } from './LegacyRescanView.js';

interface Props {
  projectId: string;
  mode: 'initial' | 'rescan';
  onClose: () => void;
}

type Step =
  | 'loading'
  | 'error'
  | 'cancelled'
  | 'done'
  | 'discovering'
  | 'picker'
  | 'generating'
  | 'review'
  | 'legacy_rescan';

function deriveStep(scan: BootstrapScan | null): Step {
  if (!scan) return 'loading';
  if (scan.status === 'failed') return 'error';
  if (scan.status === 'cancelled') return 'cancelled';
  if (scan.status === 'completed') return 'done';
  switch (scan.initPhase) {
    case 'discovering':
      return 'discovering';
    case 'picking':
      return 'picker';
    case 'generating':
      return 'generating';
    case 'reviewing':
      return 'review';
    default:
      return 'legacy_rescan';
  }
}

export function InitializeSpecsDialog({
  projectId,
  mode,
  onClose,
}: Props): React.ReactElement {
  const scan = useOpenSpecStore((s) => s.initScansByProject[projectId] ?? null);
  const setInitScan = useOpenSpecStore((s) => s.setInitScan);
  const setInitCandidates = useOpenSpecStore((s) => s.setInitCandidates);
  const [error, setError] = React.useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api
      .listBootstrapScans(projectId)
      .then(async (scans) => {
        if (cancelled) return;
        const active = scans.find(
          (s) => s.status === 'running' || s.status === 'awaiting_review',
        );
        if (active) {
          setInitScan(projectId, active);
          if (active.initPhase != null) {
            const candidates = await api.listBootstrapCandidates(active.id);
            if (!cancelled) setInitCandidates(active.id, candidates);
          }
          return;
        }
        if (cancelled) return;
        try {
          const res = await api.startBootstrap(projectId, mode);
          if (cancelled) return;
          setInitScan(projectId, res.scan);
        } catch (e) {
          const message = (e as Error).message ?? '';
          if (message.includes('bootstrap scan is already active')) {
            const refreshed = await api.listBootstrapScans(projectId);
            if (cancelled) return;
            const nowActive = refreshed.find(
              (s) => s.status === 'running' || s.status === 'awaiting_review',
            );
            if (nowActive) {
              setInitScan(projectId, nowActive);
              if (nowActive.initPhase != null) {
                const candidates = await api.listBootstrapCandidates(nowActive.id);
                if (!cancelled) setInitCandidates(nowActive.id, candidates);
              }
              return;
            }
          }
          if (!cancelled) setError(message);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, mode, setInitScan, setInitCandidates]);

  const step = deriveStep(scan);

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
          {scan?.errorMessage && (
            <div className="border border-red-500/40 rounded-md p-2 bg-red-500/10 text-xs text-red-600 whitespace-pre-wrap break-words">
              {scan.errorMessage}
            </div>
          )}
          {step === 'loading' && (
            <div className="text-sm text-muted-foreground">Loading…</div>
          )}
          {step === 'cancelled' && (
            <div className="text-sm text-muted-foreground">Scan cancelled.</div>
          )}
          {step === 'done' && (
            <div className="text-sm text-muted-foreground">Scan complete.</div>
          )}
          {step === 'discovering' && scan && <DiscoveringStep scan={scan} />}
          {step === 'picker' && scan && (
            <CapabilityPicker scan={scan} onClose={onClose} />
          )}
          {step === 'generating' && scan && <GeneratingStep scan={scan} />}
          {step === 'review' && scan && (
            <ReviewStep scan={scan} onClose={onClose} />
          )}
          {step === 'legacy_rescan' && scan && (
            <LegacyRescanView scanId={scan.id} onClose={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}
