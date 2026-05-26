import React, { useState } from 'react';

interface Props {
  initialName: string;
  initialDescription: string;
  onSave: (name: string, description: string) => Promise<void>;
  onCancel: () => void;
  allowNameEdit?: boolean;
}

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

export function EditCapabilityForm({ initialName, initialDescription, onSave, onCancel, allowNameEdit }: Props): React.ReactElement {
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const nameValid = !allowNameEdit || (KEBAB_RE.test(name) && name.length <= 60);
  const descValid = description.length > 0 && description.length <= 200;
  const canSave = nameValid && descValid && !busy;

  const save = async (): Promise<void> => {
    setBusy(true);
    setErr(null);
    try {
      await onSave(name, description);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-2 border-l-2 border-primary pl-2">
      {allowNameEdit && (
        <div>
          <label className="text-[10px] text-muted-foreground">Name (kebab-case)</label>
          <input
            className="block w-full text-xs px-2 py-1 border rounded bg-background"
            value={name}
            onChange={(e) => setName(e.target.value)}
            pattern="^[a-z][a-z0-9-]*$"
          />
          {!nameValid && <div className="text-[10px] text-red-500">Must be kebab-case (a-z, 0-9, hyphens), ≤60 chars.</div>}
        </div>
      )}
      <div>
        <label className="text-[10px] text-muted-foreground">Description</label>
        <textarea
          className="block w-full text-xs px-2 py-1 border rounded bg-background"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        {!descValid && <div className="text-[10px] text-red-500">Required, ≤200 chars.</div>}
      </div>
      {err && <div className="text-[10px] text-red-500">{err}</div>}
      <div className="flex gap-2">
        <button className="px-2 py-0.5 text-xs rounded bg-primary text-primary-foreground disabled:opacity-50" disabled={!canSave} onClick={() => void save()}>Save</button>
        <button className="px-2 py-0.5 text-xs rounded bg-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
