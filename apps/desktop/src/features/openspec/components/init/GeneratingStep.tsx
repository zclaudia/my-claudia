import React from 'react';
import type { BootstrapScan } from '../../api.js';
import { useOpenSpecStore } from '../../store.js';
import { CapabilityProgressItem } from './CapabilityProgressItem.js';

interface Props { scan: BootstrapScan; }

export function GeneratingStep({ scan }: Props): React.ReactElement {
  const candidates = useOpenSpecStore((s) => s.initCandidatesByScan[scan.id] ?? []);
  const selected = candidates.filter((c) => c.selected && c.phase !== 'excluded');
  const done = selected.filter((c) => ['generated', 'failed', 'approved', 'rejected'].includes(c.phase)).length;

  return (
    <div className="space-y-3">
      <div className="text-sm">⚙️ Generating specs… ({done} of {selected.length})</div>
      <div className="space-y-2">
        {selected.map((c) => <CapabilityProgressItem key={c.id} candidate={c} />)}
      </div>
    </div>
  );
}
