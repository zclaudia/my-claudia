import React from 'react';
import type { Candidate } from '../../api.js';
import { useOpenSpecStore } from '../../store.js';

interface Props { candidate: Candidate; }

function statusIcon(phase: Candidate['phase']): string {
  switch (phase) {
    case 'generating': return '⏳';
    case 'generated':  return '✅';
    case 'failed':     return '❌';
    case 'approved':   return '✓';
    case 'rejected':   return '✗';
    default:           return '⬜';
  }
}

export function CapabilityProgressItem({ candidate }: Props): React.ReactElement {
  const streamingMd = useOpenSpecStore((s) => s.initStreamingByCandidate[candidate.id]);

  return (
    <div className="border rounded p-2">
      <div className="flex items-center gap-2">
        <span>{statusIcon(candidate.phase)}</span>
        <span className="font-mono text-xs">{candidate.capability}</span>
        {candidate.phase === 'generating' && (
          <span className="text-xs text-muted-foreground">
            attempt {candidate.generation_attempts}/3
          </span>
        )}
      </div>
      {candidate.phase === 'generating' && streamingMd && (
        <details className="mt-2" open>
          <summary className="text-xs cursor-pointer">
            ✍️ AI is writing… ({streamingMd.length} chars)
          </summary>
          <pre className="text-[10px] mt-1 max-h-48 overflow-auto bg-muted/30 p-2 rounded whitespace-pre-wrap">
            {streamingMd.slice(-2000)}
          </pre>
        </details>
      )}
      {candidate.phase === 'failed' && candidate.error_message && (
        <div className="text-xs text-red-500 mt-1">{candidate.error_message}</div>
      )}
    </div>
  );
}
