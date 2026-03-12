import { useCallback, useRef, useEffect } from 'react';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { useIsMobile } from '../../hooks/useMediaQuery';

const MAX_CONTENT_BYTES = 100 * 1024;

interface DraftEditorModalProps {
  onFinishDraft: (content: string) => void;
}

export function DraftEditorModal({ onFinishDraft }: DraftEditorModalProps) {
  const isMobile = useIsMobile();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    isEditorOpen,
    localContent,
    isSaving,
    lastSavedAt,
    isReadOnly,
    showLockPrompt,
    activeSessionId,
    lockedByDevice,
    setLocalContent,
    closeEditor,
    forceOpen,
    openReadOnly,
    finishDraft,
    discardDraft,
    dismissLockPrompt,
  } = useDraftEditorStore();

  // Auto-focus textarea when editor opens
  useEffect(() => {
    if (isEditorOpen && textareaRef.current && !isReadOnly) {
      textareaRef.current.focus();
    }
  }, [isEditorOpen, isReadOnly]);

  // Escape key to close
  useEffect(() => {
    if (!isEditorOpen && !showLockPrompt) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showLockPrompt) {
          dismissLockPrompt();
        } else {
          closeEditor();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditorOpen, showLockPrompt, closeEditor, dismissLockPrompt]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (new TextEncoder().encode(value).length > MAX_CONTENT_BYTES) {
        return; // Don't update if exceeding limit
      }
      setLocalContent(value);
    },
    [setLocalContent]
  );

  const handleFinish = useCallback(() => {
    finishDraft(onFinishDraft);
  }, [finishDraft, onFinishDraft]);

  const contentByteSize = new TextEncoder().encode(localContent).length;
  const sizePercent = Math.round((contentByteSize / MAX_CONTENT_BYTES) * 100);
  const charCount = localContent.length;

  // Lock prompt dialog
  if (showLockPrompt && activeSessionId) {
    return (
      <>
        <div className="fixed inset-0 bg-black/50 z-50" onClick={dismissLockPrompt} />
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
          <div
            className="bg-card border border-border rounded-lg shadow-xl w-full max-w-sm pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border">
              <h3 className="text-base font-semibold">Draft Locked</h3>
            </div>
            <div className="px-4 py-4 text-sm text-muted-foreground">
              <p>This draft is being edited by another device{lockedByDevice ? ` (${lockedByDevice.slice(0, 8)})` : ''}.</p>
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
              <button
                onClick={dismissLockPrompt}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary"
              >
                Cancel
              </button>
              <button
                onClick={() => openReadOnly(activeSessionId)}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary"
              >
                Read Only
              </button>
              <button
                onClick={() => forceOpen(activeSessionId)}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90"
              >
                Force Edit
              </button>
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!isEditorOpen) return null;

  // Saving status text
  let statusText = '';
  if (isSaving) {
    statusText = 'Saving...';
  } else if (lastSavedAt) {
    statusText = 'Saved';
  }

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" onClick={() => closeEditor()} />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none safe-top-pad safe-bottom-pad">
        <div
          className={`bg-card border border-border rounded-lg shadow-xl pointer-events-auto flex flex-col ${
            isMobile
              ? 'w-full h-full rounded-none'
              : 'w-[700px] max-w-[calc(100vw-2rem)]'
          }`}
          style={isMobile ? undefined : { height: '70vh', maxHeight: 'calc(100dvh - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px) - 2rem)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-shrink-0">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold">Draft</h2>
              <span className="text-xs text-muted-foreground">
                {charCount} chars
                {sizePercent > 80 && (
                  <span className={sizePercent > 95 ? 'text-red-500' : 'text-yellow-500'}>
                    {' '}({sizePercent}%)
                  </span>
                )}
              </span>
              {statusText && (
                <span className={`text-xs ${isSaving ? 'text-muted-foreground' : 'text-green-500'}`}>
                  {statusText}
                </span>
              )}
              {isReadOnly && (
                <span className="text-xs text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded">
                  Read Only
                </span>
              )}
            </div>
            <button
              onClick={() => closeEditor()}
              className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground"
              aria-label="Close draft editor"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-hidden p-4">
            <textarea
              ref={textareaRef}
              value={localContent}
              onChange={handleChange}
              readOnly={isReadOnly}
              className={`w-full h-full resize-none bg-transparent text-sm text-foreground focus:outline-none font-mono ${
                isReadOnly ? 'opacity-60 cursor-default' : ''
              }`}
              placeholder="Write your draft here..."
              spellCheck={false}
            />
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-4 py-3 border-t border-border flex-shrink-0">
            <button
              onClick={() => discardDraft()}
              className="px-3 py-1.5 text-sm rounded border border-border text-muted-foreground hover:bg-secondary hover:text-foreground"
            >
              Discard
            </button>
            <div className="flex gap-2">
              <button
                onClick={() => closeEditor()}
                className="px-3 py-1.5 text-sm rounded border border-border hover:bg-secondary"
              >
                Close
              </button>
              {!isReadOnly && (
                <button
                  onClick={handleFinish}
                  disabled={!localContent.trim()}
                  className="px-4 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Finish & Send
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
