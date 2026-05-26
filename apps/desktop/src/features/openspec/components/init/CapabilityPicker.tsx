import React, { useState } from 'react';
import type { BootstrapScan } from '../../api.js';
import * as api from '../../api.js';
import { useOpenSpecStore } from '../../store.js';
import { CapabilityRow } from './CapabilityRow.js';
import { EditCapabilityForm } from './EditCapabilityForm.js';

interface Props {
  scan: BootstrapScan;
  onClose: () => void;
}

export function CapabilityPicker({ scan, onClose }: Props): React.ReactElement {
  const candidates = useOpenSpecStore((s) => s.initCandidatesByScan[scan.id] ?? []);
  const upsert = useOpenSpecStore((s) => s.upsertInitCandidate);
  const [adding, setAdding] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const visible = candidates.filter((c) => c.phase !== 'excluded');
  const selectedCount = visible.filter((c) => c.selected).length;

  const addCap = async (name: string, description: string): Promise<void> => {
    const c = await api.addCandidate(scan.id, { name, description });
    upsert(scan.id, c);
    setAdding(false);
  };

  const generate = async (): Promise<void> => {
    setGenerating(true);
    setError(null);
    try {
      await api.commitGeneration(scan.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="text-sm">
        ✓ Discovered {visible.length} capabilities. Pick which to document.
      </div>
      <ul className="space-y-2">
        {visible.map((c) => <CapabilityRow key={c.id} candidate={c} />)}
      </ul>
      {!adding ? (
        <button className="text-xs px-2 py-1 rounded bg-secondary" onClick={() => setAdding(true)}>+ Add capability manually</button>
      ) : (
        <EditCapabilityForm
          initialName=""
          initialDescription=""
          onSave={addCap}
          onCancel={() => setAdding(false)}
          allowNameEdit
        />
      )}
      {error && <div className="text-xs text-red-500">{error}</div>}
      <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
        <button className="px-3 py-1.5 text-sm rounded-md bg-secondary" onClick={onClose}>Cancel</button>
        <button
          className="px-3 py-1.5 text-sm rounded-md bg-primary text-primary-foreground disabled:opacity-50"
          disabled={selectedCount === 0 || generating}
          onClick={() => void generate()}
        >
          Generate {selectedCount} specs →
        </button>
      </div>
    </div>
  );
}
