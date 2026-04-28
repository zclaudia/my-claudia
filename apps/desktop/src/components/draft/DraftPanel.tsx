import { useCallback, useRef, useEffect } from 'react';
import { useDraftEditorStore } from '../../stores/draftEditorStore';

const MAX_CONTENT_BYTES = 100 * 1024;

/** Draft panel content rendered inside BottomPanel */
export function DraftPanel() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const {
    localContent,
    isSaving,
    lastSavedAt,
    isReadOnly,
    activeSessionId,
    sessionArchived,
    setLocalContent,
    closeEditor,
    finishDraft,
    discardDraft,
  } = useDraftEditorStore();

  // Auto-focus textarea when panel mounts
  useEffect(() => {
    if (textareaRef.current && !isReadOnly) {
      textareaRef.current.focus();
    }
  }, [activeSessionId, isReadOnly]);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const value = e.target.value;
      if (new TextEncoder().encode(value).length > MAX_CONTENT_BYTES) {
        return;
      }
      setLocalContent(value);
    },
    [setLocalContent]
  );

  const handleFinish = useCallback(() => {
    const cb = useDraftEditorStore.getState().sendCallback;
    if (cb) finishDraft(cb);
  }, [finishDraft]);

  const contentByteSize = new TextEncoder().encode(localContent).length;
  const sizePercent = Math.round((contentByteSize / MAX_CONTENT_BYTES) * 100);
  const charCount = localContent.length;

  let statusText = '';
  if (isSaving) {
    statusText = 'Saving...';
  } else if (lastSavedAt) {
    statusText = 'Saved';
  }

  const effectiveReadOnly = isReadOnly || sessionArchived;

  return (
    <div className="flex flex-col h-full">
      {/* Session archived banner */}
      {sessionArchived && (
        <div className="px-3 py-1.5 bg-yellow-500/10 text-yellow-500 text-xs border-b border-border flex-shrink-0">
          Session has been archived. Draft is read-only.
        </div>
      )}

      {/* Status bar */}
      <div className="flex items-center gap-3 px-3 py-1.5 border-b border-border flex-shrink-0 text-xs">
        <span className="text-muted-foreground">
          {charCount} chars
          {sizePercent > 80 && (
            <span className={sizePercent > 95 ? 'text-red-500' : 'text-yellow-500'}>
              {' '}({sizePercent}%)
            </span>
          )}
        </span>
        {statusText && (
          <span className={isSaving ? 'text-muted-foreground' : 'text-green-500'}>
            {statusText}
          </span>
        )}
        {effectiveReadOnly && !sessionArchived && (
          <span className="text-yellow-500 bg-yellow-500/10 px-2 py-0.5 rounded">
            Read Only
          </span>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1 overflow-hidden p-3">
        <textarea
          ref={textareaRef}
          value={localContent}
          onChange={handleChange}
          readOnly={effectiveReadOnly}
          className={`w-full h-full resize-none bg-transparent text-sm text-foreground focus:outline-none font-mono ${
            effectiveReadOnly ? 'opacity-60 cursor-default' : ''
          }`}
          placeholder="Write your draft here..."
          spellCheck={false}
        />
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 border-t border-border flex-shrink-0">
        <button
          onClick={() => discardDraft()}
          disabled={sessionArchived}
          className="px-3 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          Discard
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => closeEditor()}
            className="px-3 py-1 text-xs rounded border border-border hover:bg-secondary"
          >
            Close
          </button>
          {!effectiveReadOnly && (
            <button
              onClick={handleFinish}
              disabled={!localContent.trim()}
              className="px-3 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Finish & Send
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
