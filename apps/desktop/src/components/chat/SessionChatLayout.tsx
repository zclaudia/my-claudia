import { useMemo } from 'react';
import { ChatInterface } from './ChatInterface';
import { BottomPanel } from '../BottomPanel';
import { RightSidebar } from '../RightSidebar';
import { useProjectStore } from '../../stores/projectStore';
import { useUIStore } from '../../stores/uiStore';

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
