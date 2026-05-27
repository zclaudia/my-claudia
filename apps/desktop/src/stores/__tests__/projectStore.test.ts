import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import { useOwnershipStore } from '../ownershipStore';
import type { Project, Session } from '@my-claudia/shared';

const mockSetActiveServer = vi.fn();
const mockServerStoreState = {
  activeServerId: 'local',
  setActiveServer: mockSetActiveServer,
};

vi.mock('../sessionsStore', () => ({
  useSessionsStore: {
    getState: () => ({
      remoteSessions: new Map([
        ['b1', [{ id: 'remote-s1', projectId: 'p-remote' }]],
      ]),
    }),
  },
}));

vi.mock('../serverStore', () => ({
  useServerStore: {
    getState: () => mockServerStoreState,
  },
}));

vi.mock('../../utils/controlPlane', () => ({
  getControlPlaneMode: () => 'embedded-local',
  resolveLocalBackendId: () => 'local-backend-1',
  resolveCanonicalBackendId: (backendId: string | null | undefined, fallback: string | null = null) => backendId ?? fallback,
}));

vi.mock('../chatStore', () => ({
  useChatStore: {
    getState: () => ({
      activeRuns: {},
      backgroundRunIds: new Set(),
    }),
  },
}));

describe('projectStore', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    mockSetActiveServer.mockReset();
    mockServerStoreState.activeServerId = 'local';
    useProjectStore.setState({
      projects: [],
      sessions: [],
      providers: [],
      selectedProjectId: null,
      selectedSessionId: null,
      dashboardViews: {},
      providerCommands: {},
      providerCapabilities: {},
    });
    useOwnershipStore.getState().clearSessionOwners();
    useOwnershipStore.getState().clearProjectOwners();
  });

  afterEach(() => {
    consoleWarnSpy.mockRestore();
  });

  const createProject = (overrides: Partial<Project> = {}): Project => ({
    id: 'project-1',
    name: 'Test Project',
    type: 'code',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  const createSession = (overrides: Partial<Session> = {}): Session => ({
    id: 'session-1',
    projectId: 'project-1',
    name: 'Test Session',
    type: 'regular',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  describe('projects', () => {
    it('setProjects replaces projects array', () => {
      const projects = [createProject({ id: 'p1' }), createProject({ id: 'p2' })];
      useProjectStore.getState().setProjects(projects);

      expect(useProjectStore.getState().projects).toEqual(projects);
    });

    it('replaceProjectsForBackend only replaces the target backend subset', () => {
      const localOld = createProject({ id: 'local-p1', name: 'Local Old' });
      const remoteKeep = createProject({ id: 'remote-p1', name: 'Remote Keep' });
      const localNew = createProject({ id: 'local-p2', name: 'Local New' });
      useOwnershipStore.getState().setProjectOwner('local-p1', 'local-backend-1');
      useOwnershipStore.getState().setProjectOwner('remote-p1', 'remote-1');
      useProjectStore.setState({
        projects: [localOld, remoteKeep],
      });

      useProjectStore.getState().replaceProjectsForBackend('local-backend-1', [localNew]);

      expect(useProjectStore.getState().projects).toEqual([
        remoteKeep,
        localNew,
      ]);
      expect(useOwnershipStore.getState().getProjectBackendId('remote-p1')).toBe('remote-1');
      expect(useOwnershipStore.getState().getProjectBackendId('local-p1')).toBeNull();
      expect(useOwnershipStore.getState().getProjectBackendId('local-p2')).toBe('local-backend-1');
    });

    it('replaceProjectsForBackend preserves existing rootPath when snapshot project is partial', () => {
      const localFull = createProject({
        id: 'local-p1',
        name: 'Local Full',
        rootPath: '/repo/full',
        providerId: 'provider-1',
      });
      useOwnershipStore.getState().setProjectOwner('local-p1', 'local-backend-1');
      useProjectStore.setState({
        projects: [localFull],
      });

      useProjectStore.getState().replaceProjectsForBackend('local-backend-1', [
        createProject({
          id: 'local-p1',
          name: 'Local Snapshot',
          rootPath: undefined,
          providerId: undefined,
          updatedAt: localFull.updatedAt + 1,
        }),
      ]);

      expect(useProjectStore.getState().projects).toEqual([
        expect.objectContaining({
          id: 'local-p1',
          name: 'Local Snapshot',
          rootPath: '/repo/full',
          providerId: 'provider-1',
        }),
      ]);
    });

    it('replaceProjectsForBackend preserves relative position across backends', () => {
      // Repro for "project jumps to the end after a snapshot replay" — the
      // old [...otherProjects, ...currentBackendProjects] strategy moved this
      // backend's projects to the tail every time a snapshot fired.
      const local1 = createProject({ id: 'local-1', name: 'Local 1' });
      const remote1 = createProject({ id: 'remote-1', name: 'Remote 1' });
      const local2 = createProject({ id: 'local-2', name: 'Local 2' });
      const remote2 = createProject({ id: 'remote-2', name: 'Remote 2' });
      useOwnershipStore.getState().setProjectOwner('local-1', 'local-backend-1');
      useOwnershipStore.getState().setProjectOwner('remote-1', 'remote-1');
      useOwnershipStore.getState().setProjectOwner('local-2', 'local-backend-1');
      useOwnershipStore.getState().setProjectOwner('remote-2', 'remote-1');
      useProjectStore.setState({ projects: [local1, remote1, local2, remote2] });

      // Server replays the remote-1 snapshot with bumped updatedAt for remote-1
      useProjectStore.getState().replaceProjectsForBackend('remote-1', [
        createProject({ id: 'remote-1', name: 'Remote 1 Updated', updatedAt: remote1.updatedAt + 1 }),
        createProject({ id: 'remote-2', name: 'Remote 2', updatedAt: remote2.updatedAt }),
      ]);

      const ids = useProjectStore.getState().projects.map((p) => p.id);
      expect(ids).toEqual(['local-1', 'remote-1', 'local-2', 'remote-2']);
      expect(useProjectStore.getState().projects[1].name).toBe('Remote 1 Updated');
    });

    it('replaceProjectsForBackend drops backend projects no longer in the snapshot', () => {
      const a = createProject({ id: 'a', name: 'A' });
      const b = createProject({ id: 'b', name: 'B' });
      const c = createProject({ id: 'c', name: 'C' });
      useOwnershipStore.getState().setProjectOwner('a', 'remote-1');
      useOwnershipStore.getState().setProjectOwner('b', 'remote-1');
      useOwnershipStore.getState().setProjectOwner('c', 'remote-1');
      useProjectStore.setState({ projects: [a, b, c] });

      // Snapshot loses 'b'
      useProjectStore.getState().replaceProjectsForBackend('remote-1', [a, c]);

      const ids = useProjectStore.getState().projects.map((p) => p.id);
      expect(ids).toEqual(['a', 'c']);
      expect(useOwnershipStore.getState().getProjectBackendId('b')).toBeFalsy();
    });

    it('replaceProjectsForBackend appends genuinely new backend projects at the end', () => {
      const a = createProject({ id: 'a', name: 'A' });
      const b = createProject({ id: 'b', name: 'B' });
      useOwnershipStore.getState().setProjectOwner('a', 'remote-1');
      useOwnershipStore.getState().setProjectOwner('b', 'remote-1');
      useProjectStore.setState({ projects: [a, b] });

      useProjectStore.getState().replaceProjectsForBackend('remote-1', [
        a,
        b,
        createProject({ id: 'c', name: 'C' }),
      ]);

      const ids = useProjectStore.getState().projects.map((p) => p.id);
      expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('addProject appends to projects', () => {
      const p1 = createProject({ id: 'p1' });
      const p2 = createProject({ id: 'p2' });

      useProjectStore.getState().addProject(p1);
      useProjectStore.getState().addProject(p2);

      expect(useProjectStore.getState().projects).toEqual([p1, p2]);
    });

    it('addProject dedupes when the project was already inserted by a project_upsert event', () => {
      // Repro: on a remote backend the WebSocket project_upsert event arrives
      // before the HTTP createProject response, so upsertProjectForBackend pushes
      // the project first. The HTTP callback then calls addProject(project) and
      // used to append a second copy with the same id.
      const project = createProject({ id: 'race-1', name: 'Race' });
      useProjectStore.getState().upsertProjectForBackend('remote-1', project);
      useProjectStore.getState().addProject(project);

      const ids = useProjectStore.getState().projects.map((p) => p.id);
      expect(ids).toEqual(['race-1']);
    });

    it('upsertProjectForBackend updates only the matching backend project', () => {
      const remoteOriginal = createProject({ id: 'shared-id', name: 'Remote Original' });
      const localKeep = createProject({ id: 'local-p1', name: 'Local Keep' });
      useOwnershipStore.getState().setProjectOwner('shared-id', 'remote-1');
      useOwnershipStore.getState().setProjectOwner('local-p1', 'local-backend-1');
      useProjectStore.setState({
        projects: [remoteOriginal, localKeep],
      });

      useProjectStore.getState().upsertProjectForBackend('remote-1', createProject({
        id: 'shared-id',
        name: 'Remote Updated',
        updatedAt: remoteOriginal.updatedAt + 1,
      }));

      expect(useProjectStore.getState().projects).toEqual([
        expect.objectContaining({ id: 'shared-id', name: 'Remote Updated' }),
        localKeep,
      ]);
      expect(useOwnershipStore.getState().getProjectBackendId('shared-id')).toBe('remote-1');
    });

    it('upsertProjectForBackend preserves existing rootPath when event project is partial', () => {
      const remoteOriginal = createProject({
        id: 'shared-id',
        name: 'Remote Original',
        rootPath: '/repo/root',
        providerId: 'provider-1',
      });
      useOwnershipStore.getState().setProjectOwner('shared-id', 'remote-1');
      useProjectStore.setState({
        projects: [remoteOriginal],
      });

      useProjectStore.getState().upsertProjectForBackend('remote-1', createProject({
        id: 'shared-id',
        name: 'Remote Updated',
        rootPath: undefined,
        providerId: undefined,
        updatedAt: remoteOriginal.updatedAt + 1,
      }));

      expect(useProjectStore.getState().projects).toEqual([
        expect.objectContaining({
          id: 'shared-id',
          name: 'Remote Updated',
          rootPath: '/repo/root',
          providerId: 'provider-1',
        }),
      ]);
    });

    it('removeProjectForBackend ignores projects owned by a different backend', () => {
      const remoteProject = createProject({ id: 'shared-id', name: 'Remote Project' });
      const localProject = createProject({ id: 'local-p1', name: 'Local Project' });
      useOwnershipStore.getState().setProjectOwner('shared-id', 'remote-1');
      useOwnershipStore.getState().setProjectOwner('local-p1', 'local-backend-1');
      useProjectStore.setState({
        projects: [remoteProject, localProject],
      });

      useProjectStore.getState().removeProjectForBackend('local-backend-1', 'shared-id');

      expect(useProjectStore.getState().projects).toEqual([remoteProject, localProject]);
      expect(useOwnershipStore.getState().getProjectBackendId('shared-id')).toBe('remote-1');
    });

    it('upsertProjectForBackend preserves array position when ownership was missing', () => {
      // Repro: setProjects ran before activeServerId was ready, so ownership
      // was never recorded. The first project_upsert event for an existing
      // project must NOT shove it to the end of the list.
      const a = createProject({ id: 'p-a', name: 'A' });
      const b = createProject({ id: 'p-b', name: 'B' });
      const c = createProject({ id: 'p-c', name: 'C' });
      useProjectStore.setState({ projects: [a, b, c] });
      // Note: no setProjectOwner calls — this is the bug condition.
      expect(useOwnershipStore.getState().getProjectBackendId('p-b')).toBeFalsy();

      useProjectStore.getState().upsertProjectForBackend('remote-1', createProject({
        id: 'p-b',
        name: 'B Updated',
        updatedAt: b.updatedAt + 1,
      }));

      const ids = useProjectStore.getState().projects.map((p) => p.id);
      expect(ids).toEqual(['p-a', 'p-b', 'p-c']);
      expect(useProjectStore.getState().projects[1].name).toBe('B Updated');
      expect(useOwnershipStore.getState().getProjectBackendId('p-b')).toBe('remote-1');
    });

    it('upsertProjectForBackend appends genuinely new projects', () => {
      const a = createProject({ id: 'p-a', name: 'A' });
      useProjectStore.setState({ projects: [a] });

      useProjectStore.getState().upsertProjectForBackend('remote-1', createProject({
        id: 'p-new',
        name: 'New',
      }));

      const ids = useProjectStore.getState().projects.map((p) => p.id);
      expect(ids).toEqual(['p-a', 'p-new']);
    });

    it('upsertProjectForBackend ignores collisions from a different backend', () => {
      const remoteProject = createProject({ id: 'shared-id', name: 'Remote Project' });
      useOwnershipStore.getState().setProjectOwner('shared-id', 'remote-1');
      useProjectStore.setState({
        projects: [remoteProject],
      });

      useProjectStore.getState().upsertProjectForBackend('local-backend-1', createProject({
        id: 'shared-id',
        name: 'Local Collision',
      }));

      expect(useProjectStore.getState().projects).toEqual([remoteProject]);
      expect(useOwnershipStore.getState().getProjectBackendId('shared-id')).toBe('remote-1');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring project event collision for shared-id')
      );
    });

    it('replaceProjectsForBackend ignores snapshot collisions from a different backend', () => {
      const remoteProject = createProject({ id: 'shared-id', name: 'Remote Project' });
      useOwnershipStore.getState().setProjectOwner('shared-id', 'remote-1');
      useProjectStore.setState({
        projects: [remoteProject],
      });

      useProjectStore.getState().replaceProjectsForBackend('local-backend-1', [
        createProject({ id: 'shared-id', name: 'Local Collision' }),
        createProject({ id: 'local-p1', name: 'Local Project' }),
      ]);

      expect(useProjectStore.getState().projects).toEqual([
        remoteProject,
        expect.objectContaining({ id: 'local-p1', name: 'Local Project' }),
      ]);
      expect(useOwnershipStore.getState().getProjectBackendId('shared-id')).toBe('remote-1');
      expect(useOwnershipStore.getState().getProjectBackendId('local-p1')).toBe('local-backend-1');
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.stringContaining('Ignoring project snapshot collision for shared-id')
      );
    });

    it('updateProject updates specific project', () => {
      const project = createProject({ id: 'p1', name: 'Original' });
      useProjectStore.getState().setProjects([project]);

      useProjectStore.getState().updateProject('p1', { name: 'Updated' });

      expect(useProjectStore.getState().projects[0].name).toBe('Updated');
    });

    it('updateProject does not affect other projects', () => {
      const p1 = createProject({ id: 'p1', name: 'Project 1' });
      const p2 = createProject({ id: 'p2', name: 'Project 2' });
      useProjectStore.getState().setProjects([p1, p2]);

      useProjectStore.getState().updateProject('p1', { name: 'Updated' });

      expect(useProjectStore.getState().projects[1].name).toBe('Project 2');
    });

    it('deleteProject removes project', () => {
      const projects = [createProject({ id: 'p1' }), createProject({ id: 'p2' })];
      useProjectStore.getState().setProjects(projects);

      useProjectStore.getState().deleteProject('p1');

      expect(useProjectStore.getState().projects).toHaveLength(1);
      expect(useProjectStore.getState().projects[0].id).toBe('p2');
    });

    it('deleteProject removes associated sessions', () => {
      const project = createProject({ id: 'p1' });
      const session1 = createSession({ id: 's1', projectId: 'p1' });
      const session2 = createSession({ id: 's2', projectId: 'p2' });

      useProjectStore.getState().setProjects([project]);
      useProjectStore.getState().setSessions([session1, session2]);

      useProjectStore.getState().deleteProject('p1');

      expect(useProjectStore.getState().sessions).toHaveLength(1);
      expect(useProjectStore.getState().sessions[0].id).toBe('s2');
    });

    it('deleteProject clears selectedProjectId if deleted', () => {
      const project = createProject({ id: 'p1' });
      useProjectStore.getState().setProjects([project]);
      useProjectStore.getState().selectProject('p1');

      useProjectStore.getState().deleteProject('p1');

      expect(useProjectStore.getState().selectedProjectId).toBeNull();
    });

    it('deleteProject clears selectedSessionId if session belongs to deleted project', () => {
      const project = createProject({ id: 'p1' });
      const session = createSession({ id: 's1', projectId: 'p1' });
      useProjectStore.getState().setProjects([project]);
      useProjectStore.getState().setSessions([session]);
      useProjectStore.getState().selectSession('s1');

      useProjectStore.getState().deleteProject('p1');

      expect(useProjectStore.getState().selectedSessionId).toBeNull();
    });
  });

  describe('sessions', () => {
    it('setSessions prefers project ownership over active backend ownership', () => {
      useOwnershipStore.getState().setProjectOwner('project-1', 'local-backend-1');
      mockServerStoreState.activeServerId = 'remote-1';

      const session = createSession();
      useProjectStore.getState().setSessions([session]);

      expect(useOwnershipStore.getState().getSessionBackendId(session.id)).toBe('local-backend-1');
    });

    it('mergeSessions prefers project ownership over active backend ownership', () => {
      useOwnershipStore.getState().setProjectOwner('project-1', 'local-backend-1');
      mockServerStoreState.activeServerId = 'remote-1';

      const session = createSession();
      useProjectStore.getState().mergeSessions([session]);

      expect(useOwnershipStore.getState().getSessionBackendId(session.id)).toBe('local-backend-1');
    });

    it('addSession prefers project ownership over active backend ownership', () => {
      useOwnershipStore.getState().setProjectOwner('project-1', 'local-backend-1');
      mockServerStoreState.activeServerId = 'remote-1';

      const session = createSession();
      useProjectStore.getState().addSession(session);

      expect(useOwnershipStore.getState().getSessionBackendId(session.id)).toBe('local-backend-1');
    });
  });

  describe('sessions', () => {
    it('setSessions replaces sessions array', () => {
      const sessions = [createSession({ id: 's1' }), createSession({ id: 's2' })];
      useProjectStore.getState().setSessions(sessions);

      expect(useProjectStore.getState().sessions).toEqual(sessions);
    });

    it('stores canonical backend ownership for gateway-prefixed active server ids', () => {
      mockServerStoreState.activeServerId = 'gw:remote-1';

      useProjectStore.getState().setSessions([createSession({ id: 's1' })]);

      expect(useOwnershipStore.getState().getSessionBackendId('s1')).toBe('remote-1');
    });

    it('addSession appends to sessions', () => {
      const s1 = createSession({ id: 's1' });
      const s2 = createSession({ id: 's2' });

      useProjectStore.getState().addSession(s1);
      useProjectStore.getState().addSession(s2);

      expect(useProjectStore.getState().sessions).toEqual([s1, s2]);
    });

    it('updateSession updates specific session', () => {
      const session = createSession({ id: 's1', name: 'Original' });
      useProjectStore.getState().setSessions([session]);

      useProjectStore.getState().updateSession('s1', { name: 'Updated' });

      expect(useProjectStore.getState().sessions[0].name).toBe('Updated');
    });

    it('deleteSession removes session', () => {
      const sessions = [createSession({ id: 's1' }), createSession({ id: 's2' })];
      useProjectStore.getState().setSessions(sessions);

      useProjectStore.getState().deleteSession('s1');

      expect(useProjectStore.getState().sessions).toHaveLength(1);
      expect(useProjectStore.getState().sessions[0].id).toBe('s2');
    });

    it('deleteSession clears selectedSessionId if deleted', () => {
      const session = createSession({ id: 's1' });
      useProjectStore.getState().setSessions([session]);
      useProjectStore.setState({ selectedSessionId: 's1' });

      useProjectStore.getState().deleteSession('s1');

      expect(useProjectStore.getState().selectedSessionId).toBeNull();
    });

    it('reorderSessions only reorders the target project segment', () => {
      const s1 = createSession({ id: 's1', projectId: 'p1' });
      const s2 = createSession({ id: 's2', projectId: 'p1' });
      const other = createSession({ id: 's3', projectId: 'p2' });
      useProjectStore.getState().setSessions([other, s1, s2]);

      useProjectStore.getState().reorderSessions('p1', ['s2', 's1']);

      expect(useProjectStore.getState().sessions.map((s) => s.id)).toEqual(['s3', 's2', 's1']);
    });
  });

  describe('selection', () => {
    it('selectProject sets selectedProjectId', () => {
      useProjectStore.getState().selectProject('p1');

      expect(useProjectStore.getState().selectedProjectId).toBe('p1');
    });

    it('selectProject can set to null', () => {
      useProjectStore.getState().selectProject('p1');
      useProjectStore.getState().selectProject(null);

      expect(useProjectStore.getState().selectedProjectId).toBeNull();
    });

    it('selectProject is a no-op when selecting the same project again', () => {
      useProjectStore.setState({ selectedProjectId: 'p1' });
      const previousState = useProjectStore.getState();

      useProjectStore.getState().selectProject('p1');

      expect(useProjectStore.getState()).toBe(previousState);
    });

    it('selectSession sets selectedSessionId', () => {
      const session = createSession({ id: 's1', projectId: 'p1' });
      useProjectStore.getState().setSessions([session]);

      useProjectStore.getState().selectSession('s1');

      expect(useProjectStore.getState().selectedSessionId).toBe('s1');
    });

    it('selectSession switches to local backend for local sessions in embedded mode', () => {
      mockServerStoreState.activeServerId = null;
      const session = createSession({ id: 's1', projectId: 'p1' });
      useProjectStore.getState().setSessions([session]);

      useProjectStore.getState().selectSession('s1');

      expect(mockSetActiveServer).not.toHaveBeenCalled();
    });

    it('selectSession also updates selectedProjectId from session', () => {
      const session = createSession({ id: 's1', projectId: 'p1' });
      useProjectStore.getState().setSessions([session]);

      useProjectStore.getState().selectSession('s1');

      expect(useProjectStore.getState().selectedProjectId).toBe('p1');
    });

    it('selectSession with null keeps existing selectedProjectId', () => {
      useProjectStore.getState().selectProject('p1');
      useProjectStore.getState().selectSession(null);

      expect(useProjectStore.getState().selectedSessionId).toBeNull();
      expect(useProjectStore.getState().selectedProjectId).toBe('p1');
    });

    it('selectSession is a no-op when selecting the same session again', () => {
      useProjectStore.setState({
        selectedSessionId: 's1',
        selectedProjectId: 'p1',
        sessions: [createSession({ id: 's1', projectId: 'p1' })],
      });
      const previousState = useProjectStore.getState();

      useProjectStore.getState().selectSession('s1');

      expect(useProjectStore.getState()).toBe(previousState);
      expect(mockSetActiveServer).not.toHaveBeenCalled();
    });

    it('selectSession can use an explicit projectId override', () => {
      useProjectStore.getState().selectSession('remote-s1', 'p-remote');
      expect(useProjectStore.getState().selectedProjectId).toBe('p-remote');
    });

    it('selectSession does not switch backend for remote sessions by itself', () => {
      useProjectStore.getState().selectSession('remote-s1');
      expect(mockSetActiveServer).not.toHaveBeenCalled();
    });
  });

  describe('mergeSessions', () => {
    it('adds new sessions with isActive defaulting to false', () => {
      useProjectStore.getState().mergeSessions([createSession({ id: 's1' })]);
      expect((useProjectStore.getState().sessions[0] as any).isActive).toBe(false);
    });

    it('preserves existing isActive when incoming has no isActive', () => {
      useProjectStore.setState({ sessions: [{ ...createSession({ id: 's1' }), isActive: true } as any] });
      useProjectStore.getState().mergeSessions([createSession({ id: 's1', name: 'Updated' })]);
      expect((useProjectStore.getState().sessions[0] as any).isActive).toBe(true);
    });

    it('updates isActive when incoming has boolean isActive', () => {
      useProjectStore.setState({ sessions: [{ ...createSession({ id: 's1' }), isActive: true } as any] });
      useProjectStore.getState().mergeSessions([{ ...createSession({ id: 's1' }), isActive: false } as any]);
      expect((useProjectStore.getState().sessions[0] as any).isActive).toBe(false);
    });
  });

  describe('setSessionActive', () => {
    it('sets session active state', () => {
      useProjectStore.setState({ sessions: [createSession({ id: 's1' })] });
      useProjectStore.getState().setSessionActive('s1', true);
      expect((useProjectStore.getState().sessions[0] as any).isActive).toBe(true);
    });
  });

  describe('providers and capabilities', () => {
    it('setProviders replaces providers list', () => {
      useProjectStore.getState().setProviders([{ id: 'prov1' }] as any);
      expect(useProjectStore.getState().providers).toHaveLength(1);
    });

    it('setDashboardView sets view per project', () => {
      useProjectStore.getState().setDashboardView('p1', 'tasks');
      expect(useProjectStore.getState().dashboardViews.p1).toBe('tasks');
    });

    it('setProviderCommands sets commands per provider', () => {
      useProjectStore.getState().setProviderCommands('prov1', [{ command: '/help' }] as any);
      expect(useProjectStore.getState().providerCommands.prov1).toHaveLength(1);
    });

    it('setProviderCapabilities sets capabilities per provider', () => {
      useProjectStore.getState().setProviderCapabilities('prov1', { streaming: true } as any);
      expect(useProjectStore.getState().providerCapabilities.prov1).toEqual({ streaming: true });
    });
  });

  describe('deleteProject edge cases', () => {
    it('preserves selectedSessionId when session belongs to different project', () => {
      useProjectStore.setState({
        projects: [createProject({ id: 'p1' }), createProject({ id: 'p2' })],
        sessions: [createSession({ id: 's1', projectId: 'p2' })],
        selectedProjectId: 'p2',
        selectedSessionId: 's1',
      });
      useProjectStore.getState().deleteProject('p1');
      expect(useProjectStore.getState().selectedSessionId).toBe('s1');
    });
  });

  describe('deleteSession edge cases', () => {
    it('preserves selectedSessionId when different session deleted', () => {
      useProjectStore.setState({
        sessions: [createSession({ id: 's1' }), createSession({ id: 's2' })],
        selectedSessionId: 's2',
      });
      useProjectStore.getState().deleteSession('s1');
      expect(useProjectStore.getState().selectedSessionId).toBe('s2');
    });
  });
});
