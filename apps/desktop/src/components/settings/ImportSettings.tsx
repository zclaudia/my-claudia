import { useState } from 'react';
import { ImportDialog } from '../ImportDialog';
import { ImportOpenCodeDialog } from '../ImportOpenCodeDialog';

export function ImportSettings() {
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [openCodeImportDialogOpen, setOpenCodeImportDialogOpen] = useState(false);

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold">Import Data</h3>
      <p className="text-sm text-muted-foreground">
        Import sessions from other AI coding assistants. This feature allows you to migrate your conversation history.
      </p>

      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="font-medium mb-1">Claude CLI Sessions</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Import conversation history from the official Anthropic Claude CLI. You can select which sessions to import and specify the target project.
            </p>
            <button
              onClick={() => setImportDialogOpen(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-apple-sm transition-colors"
            >
              Import from Claude CLI
            </button>
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <div className="flex-1">
            <h4 className="font-medium mb-1">OpenCode Sessions</h4>
            <p className="text-sm text-muted-foreground mb-3">
              Import conversation history from OpenCode. Sessions are read from OpenCode's local SQLite database.
            </p>
            <button
              onClick={() => setOpenCodeImportDialogOpen(true)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 text-sm font-medium shadow-apple-sm transition-colors"
            >
              Import from OpenCode
            </button>
          </div>
        </div>
      </div>

      <div className="text-xs text-muted-foreground p-3 bg-secondary/50 rounded-lg">
        <strong>Note:</strong> Import functionality is only available when connected to a local server.
      </div>

      <ImportDialog isOpen={importDialogOpen} onClose={() => setImportDialogOpen(false)} />
      <ImportOpenCodeDialog isOpen={openCodeImportDialogOpen} onClose={() => setOpenCodeImportDialogOpen(false)} />
    </div>
  );
}
