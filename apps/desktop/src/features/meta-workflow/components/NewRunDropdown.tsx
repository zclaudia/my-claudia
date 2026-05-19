// apps/desktop/src/features/meta-workflow/components/NewRunDropdown.tsx
import React, { useState } from 'react';
import { sendCreateRun } from '../api.js';
import { useMetaWorkflowStore } from '../store.js';

interface Props {
  projectId: string;
  socket: { send: (msg: string) => void };
  /** Called when "New Classic Change" is clicked — preserves existing behavior. */
  onNewClassicChange: () => void;
}

export function NewRunDropdown({ projectId, socket, onNewClassicChange }: Props): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [showMetaForm, setShowMetaForm] = useState(false);
  const markPendingSelect = useMetaWorkflowStore((s) => s.markPendingSelect);

  const submitMeta = () => {
    if (!titleInput.trim()) return;
    markPendingSelect(projectId);
    sendCreateRun(socket, { projectId, title: titleInput.trim() });
    setTitleInput('');
    setShowMetaForm(false);
    setOpen(false);
    // Once the WS response upserts the new run, the store will auto-promote it
    // into selectedRunId + switch the screen to 'requirements'.
  };

  return (
    <div className="relative inline-block">
      <button
        className="px-3 py-1 text-sm border rounded bg-white hover:bg-gray-50"
        onClick={() => setOpen((v) => !v)}
      >
        New ▾
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 border bg-white shadow-lg rounded z-10">
          <button
            className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
            onClick={() => { onNewClassicChange(); setOpen(false); }}
          >
            New Classic Change
          </button>
          <button
            className="w-full text-left px-3 py-2 hover:bg-gray-100 text-sm"
            onClick={() => setShowMetaForm(true)}
          >
            New Meta Workflow Run
          </button>
          {showMetaForm && (
            <div className="p-3 border-t space-y-2">
              <input
                className="w-full border rounded px-2 py-1 text-sm"
                placeholder="Title"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button className="px-2 py-1 text-xs bg-blue-600 text-white rounded"
                        onClick={submitMeta}>
                  Create
                </button>
                <button className="px-2 py-1 text-xs border rounded"
                        onClick={() => setShowMetaForm(false)}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
