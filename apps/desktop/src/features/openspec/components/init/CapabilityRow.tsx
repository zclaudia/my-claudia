import React, { useState } from 'react';
import type { Candidate } from '../../api.js';
import * as api from '../../api.js';
import { useOpenSpecStore } from '../../store.js';
import { EditCapabilityForm } from './EditCapabilityForm.js';

interface Props {
  candidate: Candidate;
  editable?: boolean; // false in Step 4 review
}

export function CapabilityRow({ candidate, editable = true }: Props): React.ReactElement {
  const upsert = useOpenSpecStore((s) => s.upsertInitCandidate);
  const [editing, setEditing] = useState(false);

  const toggleSelected = async (): Promise<void> => {
    const c = await api.patchCandidate(candidate.id, { selected: !candidate.selected });
    upsert(candidate.scanId, c);
  };
  const remove = async (): Promise<void> => {
    await api.deleteCandidate(candidate.id);
    upsert(candidate.scanId, { ...candidate, phase: 'excluded' });
  };
  const saveEdit = async (name: string, description: string): Promise<void> => {
    const c = await api.patchCandidate(candidate.id, { title: name, description });
    upsert(candidate.scanId, c);
    setEditing(false);
  };

  if (candidate.phase === 'excluded') return <></>;

  return (
    <li className="border border-border rounded-md p-2 bg-card">
      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-2 cursor-pointer flex-1">
          {editable && (
            <input type="checkbox" checked={candidate.selected} onChange={() => void toggleSelected()} />
          )}
          <span className="font-mono text-xs">{candidate.capability}</span>
          <span className="text-xs text-muted-foreground flex-1">{candidate.description}</span>
        </label>
        {editable && (
          <div className="flex gap-1">
            <button className="px-1.5 py-0.5 text-[10px] rounded bg-secondary" onClick={() => setEditing(!editing)}>✏️ Edit</button>
            <button className="px-1.5 py-0.5 text-[10px] rounded bg-red-500/15 text-red-500" onClick={() => void remove()}>🗑</button>
          </div>
        )}
      </div>
      {editing && (
        <EditCapabilityForm
          initialName={candidate.capability}
          initialDescription={candidate.description}
          onSave={saveEdit}
          onCancel={() => setEditing(false)}
          allowNameEdit={candidate.source === 'user_added'}
        />
      )}
    </li>
  );
}
