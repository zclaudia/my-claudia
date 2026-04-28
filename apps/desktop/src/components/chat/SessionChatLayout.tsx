import { useEffect, useMemo } from 'react';
import { ChatInterface } from './ChatInterface';
import { BottomPanel } from '../BottomPanel';
import { RightSidebar } from '../RightSidebar';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';
import { usePluginStore } from '../../stores/pluginStore';
import { useDraftEditorStore } from '../../stores/draftEditorStore';
import { useFileViewerStore } from '../../stores/fileViewerStore';

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

  // Draft is session-scoped: when switching to a session whose draft store is
  // out of sync (different activeSessionId) and the draft panel is visible,
  // re-open against the current session so content reflects this session.
  // openEditor handles flushing the previous session's save and lock release.
  const draftPanelVisible = usePluginStore((s) =>
    s.panels.find((p) => p.id === 'draft')?.visible === true
  );
  useEffect(() => {
    if (!draftPanelVisible) return;
    const draft = useDraftEditorStore.getState();
    if (draft.activeSessionId === sessionId) return;
    void draft.openEditor(sessionId);
  }, [sessionId, draftPanelVisible]);

  // File viewer holds a single global state (filePath + projectRoot). When the
  // active project changes, the viewer would otherwise keep showing the old
  // project's file, so close it on project change to avoid stale content.
  useEffect(() => {
    if (!projectRoot) return;
    const viewer = useFileViewerStore.getState();
    if (viewer.isOpen && viewer.projectRoot && viewer.projectRoot !== projectRoot) {
      viewer.close();
    }
  }, [projectRoot]);

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
