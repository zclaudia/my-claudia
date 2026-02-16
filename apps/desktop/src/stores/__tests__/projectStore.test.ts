import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { Project, Session } from '@my-claudia/shared';

describe('projectStore', () => {
  beforeEach(() => {
    // Reset store state before each test
    useProjectStore.setState({
      projects: [],
      sessions: [],
      selectedProjectId: null,
      selectedSessionId: null,
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
  });
});
