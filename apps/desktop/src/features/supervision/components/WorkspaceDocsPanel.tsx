import type { ProjectChange } from '@my-claudia/shared';
import {
  type ContextDocumentPreview,
  changeStatusLabel,
  formatDocLabel,
  formatTimestamp,
  extractDocSummary,
  getEditableDocType,
} from './supervisor-utils';

interface WorkspaceDocsPanelProps {
  docs: ContextDocumentPreview[];
  selectedDocId: string | null;
  previewChange: ProjectChange | null;
  activeChange: ProjectChange | null;
  editingDocId: string | null;
  draftDocContent: string;
  loading: boolean;
  onSelectDoc: (docId: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSaveDocument: () => void;
  onDraftContentChange: (content: string) => void;
  onBackToActive: () => void;
}

export function WorkspaceDocsPanel({
  docs,
  selectedDocId,
  previewChange,
  activeChange,
  editingDocId,
  draftDocContent,
  loading,
  onSelectDoc,
  onStartEditing,
  onCancelEditing,
  onSaveDocument,
  onDraftContentChange,
  onBackToActive,
}: WorkspaceDocsPanelProps) {
  const selectedDoc = docs.find((doc) => doc.id === selectedDocId) ?? null;
  const selectedDocType = selectedDoc ? getEditableDocType(selectedDoc.id) : null;
  const isBaselineDoc = Boolean(selectedDoc?.id.startsWith('baseline/'));
  const canEditSelectedDoc = Boolean(
    selectedDocType
      && (
        isBaselineDoc
        || (
          selectedDoc
          && previewChange
          && activeChange
          && previewChange.id === activeChange.id
          && ['design', 'execution'].includes(selectedDocType)
        )
      ),
  );
  const previewAcceptanceDoc = previewChange
    ? docs.find((doc) => doc.id === `changes/${previewChange.id}/acceptance.md`) ?? null
    : null;
  const previewSyncDoc = previewChange
    ? docs.find((doc) => doc.id === `changes/${previewChange.id}/sync-log.md`) ?? null
    : null;

  return (
    <div className="flex min-w-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">Workspace Docs</h3>
          <p className="text-[11px] text-muted-foreground">
            {selectedDoc?.id.startsWith('baseline/')
              ? <>Viewing `.supervision/baseline/`</>
              : previewChange
                ? <>Viewing `.supervision/changes/{previewChange.id}`</>
                : activeChange
                  ? <>Live view from `.supervision/changes/{activeChange.id}`</>
                  : <>Viewing project baseline and workspace docs</>}
          </p>
        </div>
        {previewChange && activeChange && previewChange.id !== activeChange.id && (
          <button
            type="button"
            onClick={onBackToActive}
            disabled={loading}
            className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Back To Active
          </button>
        )}
        {((selectedDoc?.id.startsWith('baseline/')) || (previewChange && previewChange.id === activeChange?.id)) && selectedDoc && (
          <div className="flex items-center gap-2">
            {canEditSelectedDoc && editingDocId !== selectedDoc.id && (
              <button
                type="button"
                onClick={onStartEditing}
                disabled={loading}
                className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Edit
              </button>
            )}
            {editingDocId === selectedDoc.id && (
              <>
                <button
                  type="button"
                  onClick={onCancelEditing}
                  disabled={loading}
                  className="rounded bg-secondary px-2 py-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={onSaveDocument}
                  disabled={loading}
                  className="rounded bg-primary px-2 py-1 text-[11px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  Save
                </button>
              </>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-border px-3 py-2">
        {docs.map((doc) => (
          <button
            key={doc.id}
            onClick={() => onSelectDoc(doc.id)}
            className={`rounded px-2 py-1 text-xs transition-colors ${
              selectedDocId === doc.id
                ? 'bg-primary text-primary-foreground'
                : 'bg-secondary text-muted-foreground hover:text-foreground'
            }`}
          >
            {formatDocLabel(doc.id)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto px-3 py-3">
        {selectedDoc ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{selectedDoc.id}</span>
              <span>v{selectedDoc.version}</span>
            </div>
            {previewChange && (
              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-foreground">{previewChange.title}</div>
                    <div className="mt-1 text-[11px] text-muted-foreground">{previewChange.summary}</div>
                  </div>
                  <span className="rounded-full bg-background px-2 py-1 text-[10px] font-medium text-muted-foreground">
                    {changeStatusLabel[previewChange.status] ?? previewChange.status}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <div>
                    Change ID: <span className="text-foreground">{previewChange.id}</span>
                  </div>
                  <div>
                    Updated: <span className="text-foreground">{formatTimestamp(previewChange.updatedAt ?? previewChange.createdAt)}</span>
                  </div>
                </div>
                {(previewAcceptanceDoc || previewSyncDoc) && (
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {previewAcceptanceDoc && (
                      <div className="rounded border border-border bg-background px-2.5 py-2">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Acceptance
                        </div>
                        <div className="mt-1 text-[11px] text-foreground">
                          {extractDocSummary(previewAcceptanceDoc.content, 'No acceptance summary yet.')}
                        </div>
                      </div>
                    )}
                    {previewSyncDoc && (
                      <div className="rounded border border-border bg-background px-2.5 py-2">
                        <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Sync
                        </div>
                        <div className="mt-1 text-[11px] text-foreground">
                          {extractDocSummary(
                            previewSyncDoc.content,
                            previewChange.status === 'completed'
                              ? 'Change has been completed and synced.'
                              : 'Waiting for sync details.',
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            {editingDocId === selectedDoc.id ? (
              <textarea
                value={draftDocContent}
                onChange={(event) => onDraftContentChange(event.target.value)}
                rows={20}
                className="w-full rounded-lg border border-border bg-background p-3 text-xs leading-5 text-foreground resize-y"
              />
            ) : (
              <pre className="whitespace-pre-wrap rounded-lg bg-secondary/40 p-3 text-xs leading-5 text-foreground/90">
                {selectedDoc.content}
              </pre>
            )}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-center text-muted-foreground">
            <div>
              <p className="text-sm">No workspace documents loaded.</p>
              <p className="mt-1 text-xs">Set up context or select a change to view baseline, design, execution, and task docs.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
