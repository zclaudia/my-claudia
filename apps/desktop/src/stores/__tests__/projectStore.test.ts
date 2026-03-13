import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { Project, Session } from '@my-claudia/shared';

vi.mock('../sessionsStore', () => ({
  useSessionsStore: {
    getState: () => ({
      remoteSessions: new Map([
        ['b1', [{ id: 'remote-s1', projectId: 'p-remote' }]],
      ]),
    }),
  },
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
  beforeEach(() => {
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

    it('addProject appends to projects', () => {
      const p1 = createProject({ id: 'p1' });
      const p2 = createProject({ id: 'p2' });

      useProjectStore.getState().addProject(p1);
      useProjectStore.getState().addProject(p2);

      expect(useProjectStore.getState().projects).toEqual([p1, p2]);
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
    it('setSessions replaces sessions array', () => {
      const sessions = [createSession({ id: 's1' }), createSession({ id: 's2' })];
      useProjectStore.getState().setSessions(sessions);

      expect(useProjectStore.getState().sessions).toEqual(sessions);
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

    it('selectSession sets selectedSessionId', () => {
      const session = createSession({ id: 's1', projectId: 'p1' });
      useProjectStore.getState().setSessions([session]);

      useProjectStore.getState().selectSession('s1');

      expect(useProjectStore.getState().selectedSessionId).toBe('s1');
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

    it('selectSession falls back to remote sessions for gateway', () => {
      useProjectStore.getState().selectSession('remote-s1');
      expect(useProjectStore.getState().selectedProjectId).toBe('p-remote');
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
