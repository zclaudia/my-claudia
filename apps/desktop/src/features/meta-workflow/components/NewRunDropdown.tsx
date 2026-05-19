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
        className="px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80 inline-flex items-center gap-1"
        onClick={() => setOpen((v) => !v)}
      >
        New
        <span className="text-[10px] opacity-60">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-popover border border-border rounded-xl shadow-lg z-50 overflow-hidden">
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-secondary"
            onClick={() => { onNewClassicChange(); setOpen(false); }}
          >
            New Classic Change
          </button>
          <button
            className="w-full text-left px-3 py-2 text-sm hover:bg-secondary"
            onClick={() => setShowMetaForm(true)}
          >
            New Meta Workflow Run
          </button>
          {showMetaForm && (
            <div className="p-3 border-t border-border space-y-2 bg-muted/30">
              <input
                className="w-full px-2 py-1.5 bg-background border border-border rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-primary/50"
                placeholder="Title"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90"
                  onClick={submitMeta}
                >
                  Create
                </button>
                <button
                  className="flex-1 px-2.5 py-1.5 text-xs rounded-md bg-secondary hover:bg-secondary/80"
                  onClick={() => setShowMetaForm(false)}
                >
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
