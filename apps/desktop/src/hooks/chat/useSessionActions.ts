import { useCallback } from 'react';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import * as api from '../../services/api';
import type { Session, Project } from '@my-claudia/shared';
import { isDesktopTauri } from '../../utils/platform';
import { openPopoutWindow, buildWindowTitle, getConnectionParams } from '../../utils/popoutWindow';

interface UseSessionActionsParams {
  sessionId: string;
  isConnected: boolean;
  currentSession: Session | undefined;
  currentProject: Project | null | undefined;
  activeServerId: string | null;
  renameValue: string;
  setIsRenamingSession: (v: boolean) => void;
}

export function useSessionActions({
  sessionId,
  isConnected,
  currentSession,
  currentProject,
  activeServerId: _activeServerId,
  renameValue,
  setIsRenamingSession,
}: UseSessionActionsParams) {
  const { addPoppedOutSession, removePoppedOutSession } = useUIStore();

  const handleSessionRename = useCallback(async () => {
    const newName = renameValue.trim();
    setIsRenamingSession(false);
    if (!newName || !isConnected) return;
    try {
      await api.updateSession(sessionId, { name: newName });
      useProjectStore.getState().updateSession(sessionId, { name: newName });
    } catch (error) {
      console.error('Failed to rename session:', error);
    }
  }, [renameValue, setIsRenamingSession, isConnected, sessionId]);

  const handleExportSession = useCallback(async () => {
    try {
      const { markdown, sessionName } = await api.exportSession(sessionId);
      const blob = new Blob([markdown], { type: 'text/markdown' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sessionName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5]/g, '_')}.md`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to export session:', error);
    }
  }, [sessionId]);

  const handleArchiveSession = useCallback(async () => {
    if (!isConnected) return;
    try {
      await api.archiveSessions([sessionId]);
      useProjectStore.getState().deleteSession(sessionId);
    } catch (error) {
      console.error('Failed to archive session:', error);
    }
  }, [isConnected, sessionId]);

  const handlePopOut = useCallback(async () => {
    if (!isDesktopTauri()) return;
    try {
      const conn = getConnectionParams();
      const sessionName = currentSession?.name || 'Session';
      const projectName = currentProject?.name || '';
      const title = buildWindowTitle(sessionName, conn.serverName, projectName);

      const label = await openPopoutWindow({
        type: 'session-chat',
        params: { sessionWindow: sessionId, projectId: currentSession?.projectId || '' },
        title,
      });
      addPoppedOutSession(sessionId, label);

      // When the standalone window closes, remove the popped-out state
      const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
      const win = await WebviewWindow.getByLabel(label);
      if (win) {
        const unlisten = await win.onCloseRequested(() => {
          removePoppedOutSession(sessionId);
          unlisten();
        });
      }
    } catch (err) {
      console.error('[ChatInterface] Pop out failed:', err);
    }
  }, [sessionId, currentSession?.projectId, currentSession?.name, currentProject?.name, addPoppedOutSession, removePoppedOutSession]);

  const handleFocusPoppedOutWindow = useCallback(async (windowLabel: string) => {
    if (!isDesktopTauri()) return;
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('focus_window', { label: windowLabel });
    } catch (err) {
      console.error('[ChatInterface] Focus popped-out window failed:', err);
    }
  }, []);

  const handleBringBackHere = useCallback(async (windowLabel: string) => {
    if (!isDesktopTauri()) {
      removePoppedOutSession(sessionId);
      return;
    }
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('close_window', { label: windowLabel });
    } catch (err) {
      console.error('[ChatInterface] Close popped-out window failed:', err);
    }
    removePoppedOutSession(sessionId);
  }, [sessionId, removePoppedOutSession]);

  return {
    handleSessionRename,
    handleExportSession,
    handleArchiveSession,
    handlePopOut,
    handleFocusPoppedOutWindow,
    handleBringBackHere,
  };
}
