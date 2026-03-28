import { useCallback, useRef, useEffect } from 'react';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useIsMobile } from '../../hooks/useMediaQuery';
import { isDesktopTauri } from '../../utils/platform';
import { openPopoutWindow, getConnectionParams } from '../../utils/popoutWindow';

const MAX_CONTENT_BYTES = 100 * 1024;

async function openDraftInNewWindow(sessionId: string) {
  const ownerBackendId = useOwnershipStore.getState().getSessionBackendId(sessionId);
  const conn = getConnectionParams({ sessionId, backendId: ownerBackendId });
  const label = await openPopoutWindow({
    type: 'draft',
    params: { draftWindow: sessionId },
    title: `Draft — ${conn.serverName || 'Local'}`,
    width: 700,
    height: 500,
    dragDropEnabled: true,
    connectionTarget: { sessionId, backendId: ownerBackendId },
  });

  useDraftEditorStore.getState().setPoppedOut(true, label);
  usePluginStore.getState().updatePanelVisibility('draft', false);
}

/** Draft panel toolbar actions (pop-out button) */
export function DraftActions() {
  const activeSessionId = useDraftEditorStore((s) => s.activeSessionId);
  const isMobile = useIsMobile();

  if (!isDesktopTauri() || isMobile || !activeSessionId) return null;

  return (
    <button
      onClick={() => openDraftInNewWindow(activeSessionId)}
      className="p-1 rounded hover:bg-secondary text-muted-foreground"
      title="Open in new window"
    >
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </button>
  );
}

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
