import { useCallback, useRef, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ConnectionProvider, useConnection } from '../../contexts/ConnectionContext';
import { WindowContextBar } from '../../features/chat/SessionChatWindow';
import * as api from '../../services/api';

const MAX_CONTENT_BYTES = 100 * 1024;
const CLIENT_DEVICE_ID = crypto.randomUUID();
const SAVE_DEBOUNCE_MS = 1500;
const SESSION_CHECK_INTERVAL_MS = 30_000;

/** Notify main window when this draft window closes */
function useWindowCloseSync(sessionId: string) {
  useEffect(() => {
    let dispose: (() => void) | undefined;
    (async () => {
      const { emitTo } = await import('@tauri-apps/api/event');
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      const win = getCurrentWindow();
      const unlistenCloseRequested = await win.onCloseRequested(() => {
        void emitTo('main', 'draft-window-closed', { sessionId }).catch(() => {});
      });
      dispose = () => { unlistenCloseRequested(); };
    })();
    return () => { dispose?.(); };
  }, [sessionId]);
}

interface DraftWindowProps {
  sessionId: string;
  serverUrl: string;
  authToken: string;
  serverId?: string;
  serverName?: string;
  gatewayUrl?: string;
  gatewaySecret?: string;
}

export function DraftWindow({
  sessionId,
  serverUrl,
  authToken: _authToken,
  serverId,
  serverName,
  gatewayUrl,
  gatewaySecret,
}: DraftWindowProps) {
  return (
    <div className="flex flex-col h-dvh bg-background text-foreground">
      {serverName && (
        <WindowContextBar serverName={serverName} />
      )}
      <ConnectionProvider
        standaloneServerUrl={serverUrl}
        standaloneServerId={serverId}
        standaloneServerName={serverName}
        standaloneGatewayUrl={gatewayUrl}
        standaloneGatewaySecret={gatewaySecret}
      >
        <DraftWindowContent sessionId={sessionId} />
      </ConnectionProvider>
    </div>
  );
}

function DraftWindowContent({ sessionId }: { sessionId: string }) {
  useWindowCloseSync(sessionId);
  const { isConnected } = useConnection();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [sessionArchived, setSessionArchived] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hasDraftContent = useCallback((value: string) => !!value.trim(), []);

  // Load draft and acquire lock on connect
  useEffect(() => {
    if (!isConnected) return;
    let cancelled = false;

    (async () => {
      try {
        const result = await api.lockSessionDraft(sessionId, CLIENT_DEVICE_ID, true);
        if (cancelled) return;
        setContent(result.draft?.content || '');
        setLastSavedAt(result.draft?.updatedAt || null);
        setIsReadOnly(!result.locked);
        setLoaded(true);
      } catch (error) {
        console.error('[DraftWindow] Failed to load draft:', error);
        setIsReadOnly(true);
        setLoaded(true);
      }
    })();

    return () => { cancelled = true; };
  }, [isConnected, sessionId]);

  // Periodically check if session is archived
  useEffect(() => {
    if (!isConnected) return;
    const check = async () => {
      try {
        const sessions = await api.getSessions();
        const session = sessions.find((s) => s.id === sessionId);
        if (session && (session as any).archivedAt) {
          setSessionArchived(true);
          setIsReadOnly(true);
        }
      } catch { /* ignore */ }
    };
    check();
    const interval = setInterval(check, SESSION_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isConnected, sessionId]);

  // Release lock on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      api.unlockSessionDraft(sessionId, CLIENT_DEVICE_ID).catch(() => {});
    };
  }, [sessionId]);

  const saveDraft = useCallback(async (value: string) => {
    setIsSaving(true);
    try {
      if (!hasDraftContent(value)) {
        await api.deleteSessionDraft(sessionId);
        setLastSavedAt(null);
        return;
      }
      const draft = await api.upsertSessionDraft(sessionId, value, CLIENT_DEVICE_ID);
      if (draft) setLastSavedAt(draft.updatedAt);
    } catch (error) {
      console.error('[DraftWindow] Failed to save:', error);
    } finally {
      setIsSaving(false);
    }
  }, [hasDraftContent, sessionId]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    if (new TextEncoder().encode(value).length > MAX_CONTENT_BYTES) return;
    setContent(value);

    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveDraft(value), SAVE_DEBOUNCE_MS);
  }, [saveDraft]);

  const handleDiscard = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    try {
      await api.deleteSessionDraft(sessionId);
    } catch { /* ignore */ }
    // Close window
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().close();
  }, [sessionId]);

  const handleClose = useCallback(async () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    if (!isReadOnly) {
      await saveDraft(content);
    }
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    getCurrentWindow().close();
  }, [content, isReadOnly, saveDraft]);

  if (!isConnected || !loaded) {
    return (
      <div className="flex items-center justify-center h-full gap-2 text-muted-foreground">
        <Loader2 size={16} className="animate-spin" />
        <span className="text-sm">{!isConnected ? 'Connecting...' : 'Loading draft...'}</span>
      </div>
    );
  }

  const contentByteSize = new TextEncoder().encode(content).length;
  const sizePercent = Math.round((contentByteSize / MAX_CONTENT_BYTES) * 100);
  const charCount = content.length;
  const effectiveReadOnly = isReadOnly || sessionArchived;

  let statusText = '';
  if (isSaving) statusText = 'Saving...';
  else if (lastSavedAt) statusText = 'Saved';

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Drag region header */}
      <div
        className="flex items-center gap-2 px-3 py-1.5 border-b border-border flex-shrink-0 bg-card"
        data-tauri-drag-region
      >
        <svg className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        <span className="text-xs font-medium text-muted-foreground truncate" data-tauri-drag-region>
          Draft
        </span>
        <span className="text-[10px] text-muted-foreground">
          {charCount} chars
          {sizePercent > 80 && (
            <span className={sizePercent > 95 ? 'text-red-500' : 'text-yellow-500'}>
              {' '}({sizePercent}%)
            </span>
          )}
        </span>
        {statusText && (
          <span className={`text-[10px] ${isSaving ? 'text-muted-foreground' : 'text-green-500'}`}>
            {statusText}
          </span>
        )}
        {effectiveReadOnly && !sessionArchived && (
          <span className="text-[10px] text-yellow-500 bg-yellow-500/10 px-1.5 py-0.5 rounded">
            Read Only
          </span>
        )}
      </div>

      {/* Session archived banner */}
      {sessionArchived && (
        <div className="px-3 py-1.5 bg-yellow-500/10 text-yellow-500 text-xs border-b border-border flex-shrink-0">
          Session has been archived. Draft is read-only.
        </div>
      )}

      {/* Editor */}
      <div className="flex-1 overflow-hidden p-3">
        <textarea
          ref={textareaRef}
          value={content}
          onChange={handleChange}
          readOnly={effectiveReadOnly}
          autoFocus
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
          onClick={handleDiscard}
          disabled={sessionArchived}
          className="px-3 py-1 text-xs rounded border border-border text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-50"
        >
          Discard
        </button>
        <button
          onClick={handleClose}
          className="px-3 py-1 text-xs rounded border border-border hover:bg-secondary"
        >
          Save & Close
        </button>
      </div>
    </div>
  );
}
