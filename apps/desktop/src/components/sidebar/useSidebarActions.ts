import { useCallback } from 'react';
import { isDesktopTauri } from '../../utils/platform';
import { openPopoutWindow } from '../../utils/popoutWindow';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useUIStore } from '../../stores/uiStore';
import { isLegacyLocalBackendId, resolveCanonicalBackendId } from '../../utils/controlPlane';
import { useSelectionCoordinator } from '../../hooks/useSelectionCoordinator';
import type { Project, Session } from '@my-claudia/shared';
import * as api from '../../services/api';
import { reorderProjects } from '../../services/api/projects';
import { reorderSessions } from '../../services/api/sessions';

interface UseSidebarActionsOptions {
  isConnected: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  addProject: (project: Project) => void;
  addSession: (session: Session) => void;
  deleteProject: (id: string) => void;
  storeReorderProjects: (ids: string[]) => void;
  storeReorderSessions: (projectId: string, ids: string[]) => void;
  getFilteredSessionsForProject: (projectId: string) => { id: string }[];
  setExpandedProjects: React.Dispatch<React.SetStateAction<Set<string>>>;
  setNewProjectName: (v: string) => void;
  setNewProjectRootPath: (v: string) => void;
  setShowNewProjectForm: (v: boolean) => void;
  setNewSessionName: (v: string) => void;
  setNewSessionProviderId: (v: string) => void;
  setCreatingSessionForProject: (v: string | null) => void;
  setCreatingProject: (v: boolean) => void;
  setContextMenuProject: (v: string | null) => void;
  newProjectName: string;
  newProjectRootPath: string;
  newSessionName: string;
  newSessionProviderId: string;
}

/**
 * Encapsulates all action callbacks for the Sidebar (create/delete/reorder/select).
 */
export function useSidebarActions({
  isConnected,
  isMobile,
  onClose,
  addProject,
  addSession,
  deleteProject,
  storeReorderProjects,
  storeReorderSessions,
  getFilteredSessionsForProject,
  setExpandedProjects,
  setNewProjectName,
  setNewProjectRootPath,
  setShowNewProjectForm,
  setNewSessionName,
  setNewSessionProviderId,
  setCreatingSessionForProject,
  setCreatingProject,
  setContextMenuProject,
  newProjectName,
  newProjectRootPath,
  newSessionName,
  newSessionProviderId,
}: UseSidebarActionsOptions) {
  const requestMessageJump = useUIStore((s) => s.requestMessageJump);
  const {
    selectProject,
    selectSession,
    selectSessionOnBackend,
  } = useSelectionCoordinator();

  const handleActiveSessionSelect = useCallback((backendId: string, sessionId: string) => {
    useUIStore.getState().requestForceScrollToBottom(sessionId);
    if (isLegacyLocalBackendId(backendId)) {
      const resolvedBackendId = resolveCanonicalBackendId(backendId, backendId);
      if (resolvedBackendId) selectSessionOnBackend(resolvedBackendId, sessionId);
      return;
    }
    selectSessionOnBackend(backendId, sessionId);
  }, [selectSessionOnBackend]);

  const handleCreateProject = useCallback(async () => {
    if (!newProjectName.trim() || !isConnected) return;
    setCreatingProject(true);
    try {
      const project = await api.createProject({
        name: newProjectName.trim(),
        type: 'code',
        rootPath: newProjectRootPath.trim() || undefined,
      });
      addProject(project);
      setNewProjectName('');
      setNewProjectRootPath('');
      setShowNewProjectForm(false);
      setExpandedProjects((prev) => new Set(prev).add(project.id));
      selectProject(project.id);
    } catch (error) {
      console.error('Failed to create project:', error);
    } finally {
      setCreatingProject(false);
    }
  }, [newProjectName, newProjectRootPath, isConnected, addProject, selectProject, setCreatingProject, setExpandedProjects, setNewProjectName, setNewProjectRootPath, setShowNewProjectForm]);

  const handleCreateSession = useCallback(async (projectId: string) => {
    if (!isConnected) return;
    try {
      const session = await api.createSession({
        projectId,
        name: newSessionName.trim() || undefined,
        providerId: newSessionProviderId || undefined,
      });
      addSession(session);
      setNewSessionName('');
      setNewSessionProviderId('');
      setCreatingSessionForProject(null);
      selectSession(session.id);
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, [isConnected, newSessionName, newSessionProviderId, addSession, selectSession, setNewSessionName, setNewSessionProviderId, setCreatingSessionForProject]);

  const handleDeleteProject = useCallback(async (projectId: string) => {
    if (!isConnected) return;
    try {
      await api.deleteProject(projectId);
      deleteProject(projectId);
      setContextMenuProject(null);
    } catch (error) {
      console.error('Failed to delete project:', error);
    }
  }, [isConnected, deleteProject, setContextMenuProject]);

  const handleReorderProjects = useCallback((orderedIds: string[]) => {
    storeReorderProjects(orderedIds);
    reorderProjects(orderedIds).catch((err) => console.error('[Sidebar] Failed to persist project order:', err));
  }, [storeReorderProjects]);

  const handleReorderSessions = useCallback((projectId: string, orderedIds: string[]) => {
    const currentVisibleIds = getFilteredSessionsForProject(projectId).map((session) => session.id);
    const reorderedSet = new Set(orderedIds);
    const nextSubset = [...orderedIds];
    const mergedIds = currentVisibleIds.map((id) => (
      reorderedSet.has(id) ? (nextSubset.shift() ?? id) : id
    ));
    storeReorderSessions(projectId, mergedIds);
    reorderSessions(projectId, mergedIds).catch((err) => console.error('[Sidebar] Failed to persist session order:', err));
  }, [getFilteredSessionsForProject, storeReorderSessions]);

  const handleSearchResultSelect = useCallback((sessionId: string, messageId: string, ownerBackendId?: string) => {
    requestMessageJump(sessionId, messageId);
    selectSession(sessionId, { backendId: ownerBackendId });
    if (onClose) onClose();
  }, [requestMessageJump, selectSession, onClose]);

  const handleSessionSelect = useCallback((sessionId: string) => {
    selectSession(sessionId);
    if (isMobile && onClose) onClose();
  }, [selectSession, isMobile, onClose]);

  const handlePopOutSession = useCallback((sessionId: string, projectId: string) => {
    openSessionInNewWindow(sessionId, projectId);
  }, []);

  return {
    selectProject,
    selectSession,
    handleActiveSessionSelect,
    handleCreateProject,
    handleCreateSession,
    handleDeleteProject,
    handleReorderProjects,
    handleReorderSessions,
    handleSearchResultSelect,
    handleSessionSelect,
    handlePopOutSession,
  };
}

async function openSessionInNewWindow(sessionId: string, projectId: string) {
  if (!isDesktopTauri()) return;
  try {
    const ownerBackendId = useOwnershipStore.getState().getSessionBackendId(sessionId);
    const label = await openPopoutWindow({
      type: 'session-chat',
      params: { sessionWindow: sessionId, projectId },
      title: 'Session',
      connectionTarget: { sessionId, backendId: ownerBackendId },
    });
    useUIStore.getState().addPoppedOutSession(sessionId, label);
    const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
    const win = await WebviewWindow.getByLabel(label);
    if (win) {
      const unlisten = await win.onCloseRequested(() => {
        useUIStore.getState().removePoppedOutSession(sessionId);
        unlisten();
      });
    }
  } catch (err) {
    console.error('[Sidebar] Pop out session failed:', err);
  }
}
