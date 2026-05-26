// apps/desktop/src/features/openspec/ws-handlers.ts
//
// Routes `bootstrap_event` WebSocket payloads to the OpenSpec Zustand store.
// The server streams a single `bootstrap_event` message type with a
// `payload.kind` discriminator covering the init flow lifecycle
// (phase1 discovery, candidate updates, generation streaming, finalization).
// On each event we either:
//   - refetch authoritative state via the REST API (phase1 transitions,
//     scan finalized — where we also refresh the corpus), or
//   - apply the payload directly to the store (candidate upsert, streaming
//     chunks).

import { useOpenSpecStore } from './store.js';
import * as api from './api.js';
import type { Candidate, BootstrapScan } from './api.js';

interface BootstrapEvent {
  type: 'bootstrap_event';
  scanId: string;
  projectId: string;
  payload: {
    kind: string;
    candidate?: Candidate;
    candidateId?: string;
    contentSoFar?: string;
    scan?: BootstrapScan;
    [k: string]: unknown;
  };
}

export function handleBootstrapEvent(msg: BootstrapEvent): void {
  const store = useOpenSpecStore.getState();
  const { scanId, projectId, payload } = msg;
  switch (payload.kind) {
    case 'phase1_started':
    case 'phase1_completed':
    case 'phase1_failed':
      void api.getBootstrapScan(scanId).then((s) => store.setInitScan(projectId, s));
      void api.listBootstrapCandidates(scanId).then((c) => store.setInitCandidates(scanId, c));
      return;

    case 'candidate_updated':
    case 'candidate_generation_started':
    case 'candidate_generation_completed':
    case 'candidate_generation_failed':
      if (payload.candidate) {
        store.upsertInitCandidate(scanId, payload.candidate);
      }
      if (
        payload.kind === 'candidate_generation_completed' ||
        payload.kind === 'candidate_generation_failed'
      ) {
        const id = payload.candidate?.id ?? payload.candidateId;
        if (id) store.clearStreaming(id);
      }
      return;

    case 'candidate_generation_progress':
      if (payload.candidateId && typeof payload.contentSoFar === 'string') {
        store.appendStreamingChunk(payload.candidateId, payload.contentSoFar);
      }
      return;

    case 'scan_finalized':
    case 'scan_cancelled':
      if (payload.scan) store.setInitScan(projectId, payload.scan);
      if (payload.kind === 'scan_finalized') {
        void api.listCorpus(projectId).then((c) => store.setCorpus(projectId, c));
      }
      return;
  }
}
