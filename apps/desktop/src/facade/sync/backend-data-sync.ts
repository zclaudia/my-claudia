import type { BackendFacadeEvent } from '@my-claudia/shared';
import { useOwnershipStore } from '../../stores/ownershipStore';
import { useProjectStore } from '../../stores/projectStore';
import { useRecoveryStore } from '../../stores/recoveryStore';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useSessionRunStateStore } from '../../stores/sessionRunStateStore';

export function syncBackendDataSnapshot(event: Extract<BackendFacadeEvent, { type: 'backend_data_snapshot' }>): void {
  const { backendId, sessions, projects } = event;
  const activeItems = sessions.filter((item) => !item.archived);
  const mappedSessions = activeItems.map(item => ({
    id: item.sessionId,
    projectId: item.projectId || '',
    name: item.title || '',
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    isActive: item.runStatus === 'running' || item.runStatus === 'waiting',
    type: 'regular' as const,
  }));

  const currentSessions = useSessionsStore.getState().remoteSessions.get(backendId);
  const sessionsChanged = !currentSessions
    || currentSessions.length !== mappedSessions.length
    || currentSessions.some((s, i) =>
      s.id !== mappedSessions[i].id
      || s.updatedAt !== mappedSessions[i].updatedAt
      || s.isActive !== mappedSessions[i].isActive
    );

  const ownershipVersion = useRecoveryStore.getState().noteDataSyncSucceeded(backendId);
  useOwnershipStore.getState().stampSessionOwnershipVersion(
    activeItems.map(item => item.sessionId),
    ownershipVersion,
  );

  if (sessionsChanged) {
    useSessionsStore.getState().setRemoteSessions(backendId, mappedSessions);
  }

  const activeSessionIds = new Set(
    activeItems.filter(item => item.runStatus === 'running' || item.runStatus === 'waiting').map(item => item.sessionId)
  );
  useSessionsStore.getState().reconcileActiveStatus(backendId, activeSessionIds);
  useSessionRunStateStore.getState().reconcileBackendSessionStatuses({
    backendId,
    sessions: activeItems.map((item) => ({
      sessionId: item.sessionId,
      runStatus: item.runStatus,
    })),
    knownSessionIds: [
      ...(currentSessions?.map((session) => session.id) ?? []),
      ...mappedSessions.map((session) => session.id),
    ],
    source: 'backend_snapshot',
  });

  if (projects) {
    useProjectStore.getState().replaceProjectsForBackend(backendId, projects.map(p => ({
      id: p.projectId,
      name: p.name,
      type: 'code' as const,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })));
  }
}

export function syncBackendDataEvent(event: Extract<BackendFacadeEvent, { type: 'backend_data_event' }>): void {
  const { backendId, event: dataEvent } = event;
  if (dataEvent.op === 'session_upsert') {
    const item = dataEvent.item;
    if (item.archived) {
      useSessionsStore.getState().handleSessionEvent(backendId, 'deleted', {
        id: item.sessionId,
        projectId: item.projectId || '',
        isActive: false,
        type: 'regular' as const,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
      });
      useSessionRunStateStore.getState().markSessionInactive({
        backendId,
        sessionId: item.sessionId,
        source: 'backend_event',
      });
      return;
    }
    const sessionStore = useSessionsStore.getState();
    const existingSessions = sessionStore.remoteSessions.get(backendId) || [];
    const eventType = existingSessions.some(s => s.id === item.sessionId)
      ? 'updated' : 'created';
    sessionStore.handleSessionEvent(backendId, eventType, {
      id: item.sessionId,
      projectId: item.projectId || '',
      name: item.title || '',
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
      isActive: item.runStatus === 'running' || item.runStatus === 'waiting',
      type: 'regular' as const,
    });
    useSessionRunStateStore.getState().applySessionRunStatus({
      backendId,
      sessionId: item.sessionId,
      runStatus: item.runStatus,
      source: 'backend_event',
    });
  } else if (dataEvent.op === 'session_remove') {
    useSessionsStore.getState().handleSessionEvent(backendId, 'deleted', {
      id: dataEvent.sessionId,
      projectId: '',
      isActive: false,
      type: 'regular' as const,
      createdAt: 0,
      updatedAt: 0,
    });
    useSessionRunStateStore.getState().markSessionInactive({
      backendId,
      sessionId: dataEvent.sessionId,
      source: 'backend_event',
    });
  } else if (dataEvent.op === 'project_upsert') {
    const p = dataEvent.item;
    useProjectStore.getState().upsertProjectForBackend(backendId, {
      id: p.projectId,
      name: p.name,
      type: 'code' as const,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    });
  } else if (dataEvent.op === 'project_remove') {
    useProjectStore.getState().removeProjectForBackend(backendId, dataEvent.projectId);
  }
}
