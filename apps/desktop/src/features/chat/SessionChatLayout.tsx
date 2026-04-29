import { useEffect, useMemo } from 'react';
import { ChatInterface } from './ChatInterface';
import { BottomPanel } from '../../components/BottomPanel';
import { RightSidebar } from '../../components/RightSidebar';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';
import { useTerminalStore } from '../../stores/terminalStore';
import { useServerStore } from '../../stores/serverStore';

interface SessionChatLayoutProps {
  sessionId: string;
  onReturnToDashboard?: (projectId: string) => void;
  onOpenSidebar?: () => void;
}

/**
 * Hosts chat and tool panels as siblings so high-frequency chat streaming
 * updates do not re-render right-side panel content.
 */
export function SessionChatLayout({
  sessionId,
  onReturnToDashboard,
  onOpenSidebar,
}: SessionChatLayoutProps) {
  const currentSession = useProjectStore((s) => s.sessions.find((session) => session.id === sessionId) ?? null);
  const currentProject = useProjectStore((s) =>
    currentSession ? s.projects.find((project) => project.id === currentSession.projectId) ?? null : null
  );
  const poppedOutLabel = useUIStore((s) => s.poppedOutSessions.get(sessionId));

  const projectRoot = currentSession?.workingDirectory || currentProject?.rootPath;
  const workingDirectory = currentSession?.workingDirectory;
  const projectId = currentSession?.projectId;

  // Draft is session-scoped: when the draft panel is visible but the store's
  // activeSessionId doesn't match the current session, re-open against this
  // session. openEditor handles flushing the previous session's save and
  // releasing its lock in the background.
  const draftPanelVisible = usePluginStore((s) =>
    s.panels.find((p) => p.id === 'draft')?.visible === true
  );
  useEffect(() => {
    if (!draftPanelVisible) return;
    const draft = useDraftEditorStore.getState();
    if (draft.activeSessionId === sessionId) return;
    void draft.openEditor(sessionId);
  }, [sessionId, draftPanelVisible]);

  // File viewer holds a single global state. When the active project changes,
  // close the viewer so it doesn't keep showing the previous project's file.
  // The panel-level guard renders an empty state during the transition, and
  // close() will clear panel.visible so the tab disappears too.
  useEffect(() => {
    if (!projectRoot) return;
    const viewer = useFileViewerStore.getState();
    if (viewer.isOpen && viewer.projectRoot && viewer.projectRoot !== projectRoot) {
      viewer.close();
    }
  }, [projectRoot]);

  // Terminal is project + backend scoped, but its `panels.visible` flag is
  // global. Without this sync, opening a terminal in project A keeps the tab
  // visible after switching to project B (which shows "No terminal session").
  // Re-sync visibility to match whether *the current project* has an open
  // drawer, so the tab only appears when it has real content.
  const activeServerId = useServerStore((s) => s.activeServerId);
  useEffect(() => {
    if (!projectId) return;
    const term = useTerminalStore.getState();
    const open = term.isDrawerOpen(projectId, activeServerId);
    const panels = usePluginStore.getState().panels;
    const current = panels.find((p) => p.id === 'terminal')?.visible === true;
    if (current !== open) {
      usePluginStore.getState().updatePanelVisibility('terminal', open);
    }
  }, [projectId, activeServerId]);

  const bottomPanel = useMemo(() => {
    if (poppedOutLabel) return undefined;
    return (
      <BottomPanel
        projectId={projectId}
        projectRoot={projectRoot}
        workingDirectory={workingDirectory}
      />
    );
  }, [poppedOutLabel, projectId, projectRoot, workingDirectory]);

  return (
    <div className="flex flex-row h-full min-w-0 bg-background">
      <ChatInterface
        sessionId={sessionId}
        onReturnToDashboard={onReturnToDashboard}
        onOpenSidebar={onOpenSidebar}
        beforeComposer={bottomPanel}
      />
      {!poppedOutLabel && (
        <RightSidebar
          projectId={projectId}
          projectRoot={projectRoot}
          workingDirectory={workingDirectory}
        />
      )}
    </div>
  );
}
