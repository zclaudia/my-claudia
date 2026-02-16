import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionsStore, type RemoteSession } from '../sessionsStore';

describe('sessionsStore', () => {
  beforeEach(() => {
    useSessionsStore.setState({ remoteSessions: new Map() });
  });

  const createRemoteSession = (overrides: Partial<RemoteSession> = {}): RemoteSession => ({
    id: 'session-1',
    projectId: 'project-1',
    name: 'Test Session',
    type: 'regular',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isActive: false,
    ...overrides,
  });

  describe('setRemoteSessions', () => {
    it('sets sessions for a backend', () => {
      const sessions = [
        createRemoteSession({ id: 's1' }),
        createRemoteSession({ id: 's2' }),
      ];
      useSessionsStore.getState().setRemoteSessions('backend-1', sessions);

      const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
      expect(stored).toEqual(sessions);
    });

    it('replaces existing sessions for a backend', () => {
      const oldSessions = [createRemoteSession({ id: 's-old' })];
      const newSessions = [createRemoteSession({ id: 's-new' })];

      useSessionsStore.getState().setRemoteSessions('backend-1', oldSessions);
      useSessionsStore.getState().setRemoteSessions('backend-1', newSessions);

      const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
      expect(stored).toHaveLength(1);
      expect(stored![0].id).toBe('s-new');
    });

    it('does not affect other backends', () => {
      const sessions1 = [createRemoteSession({ id: 's1' })];
      const sessions2 = [createRemoteSession({ id: 's2' })];

      useSessionsStore.getState().setRemoteSessions('backend-1', sessions1);
      useSessionsStore.getState().setRemoteSessions('backend-2', sessions2);

      expect(useSessionsStore.getState().remoteSessions.get('backend-1')).toEqual(sessions1);
      expect(useSessionsStore.getState().remoteSessions.get('backend-2')).toEqual(sessions2);
    });

    it('can set empty sessions array', () => {
      useSessionsStore.getState().setRemoteSessions('backend-1', []);

      const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
      expect(stored).toEqual([]);
    });
  });

  describe('handleSessionEvent', () => {
    describe('created', () => {
      it('adds a new session to an empty backend', () => {
        const session = createRemoteSession({ id: 's1' });
        useSessionsStore.getState().handleSessionEvent('backend-1', 'created', session);

        const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
        expect(stored).toHaveLength(1);
        expect(stored![0]).toEqual(session);
      });

      it('appends a session to existing sessions', () => {
        const existing = createRemoteSession({ id: 's1' });
        useSessionsStore.getState().setRemoteSessions('backend-1', [existing]);

        const newSession = createRemoteSession({ id: 's2' });
        useSessionsStore.getState().handleSessionEvent('backend-1', 'created', newSession);

        const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
        expect(stored).toHaveLength(2);
        expect(stored![1]).toEqual(newSession);
      });
    });

    describe('updated', () => {
      it('updates an existing session', () => {
        const session = createRemoteSession({ id: 's1', name: 'Original' });
        useSessionsStore.getState().setRemoteSessions('backend-1', [session]);

        const updated = createRemoteSession({ id: 's1', name: 'Updated', isActive: true });
        useSessionsStore.getState().handleSessionEvent('backend-1', 'updated', updated);

        const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
        expect(stored).toHaveLength(1);
        expect(stored![0].name).toBe('Updated');
        expect(stored![0].isActive).toBe(true);
      });

      it('does not change other sessions when updating', () => {
        const s1 = createRemoteSession({ id: 's1', name: 'Session 1' });
        const s2 = createRemoteSession({ id: 's2', name: 'Session 2' });
        useSessionsStore.getState().setRemoteSessions('backend-1', [s1, s2]);

        const updated = createRemoteSession({ id: 's1', name: 'Updated 1' });
        useSessionsStore.getState().handleSessionEvent('backend-1', 'updated', updated);

        const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
        expect(stored![0].name).toBe('Updated 1');
        expect(stored![1].name).toBe('Session 2');
      });

      it('leaves sessions unchanged if id does not match', () => {
        const session = createRemoteSession({ id: 's1', name: 'Original' });
        useSessionsStore.getState().setRemoteSessions('backend-1', [session]);

        const nonMatching = createRemoteSession({ id: 's-nonexistent', name: 'Nope' });
        useSessionsStore.getState().handleSessionEvent('backend-1', 'updated', nonMatching);

        const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
        expect(stored).toHaveLength(1);
        expect(stored![0].name).toBe('Original');
      });
    });

    describe('deleted', () => {
      it('removes a session by id', () => {
        const s1 = createRemoteSession({ id: 's1' });
        const s2 = createRemoteSession({ id: 's2' });
        useSessionsStore.getState().setRemoteSessions('backend-1', [s1, s2]);

        useSessionsStore.getState().handleSessionEvent('backend-1', 'deleted', s1);

        const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
        expect(stored).toHaveLength(1);
        expect(stored![0].id).toBe('s2');
      });

      it('handles deleting from an empty backend gracefully', () => {
        const session = createRemoteSession({ id: 's1' });
        useSessionsStore.getState().handleSessionEvent('backend-1', 'deleted', session);

        const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
        expect(stored).toEqual([]);
      });

      it('does nothing if session id does not exist', () => {
        const session = createRemoteSession({ id: 's1' });
        useSessionsStore.getState().setRemoteSessions('backend-1', [session]);

        const nonMatching = createRemoteSession({ id: 's-nonexistent' });
        useSessionsStore.getState().handleSessionEvent('backend-1', 'deleted', nonMatching);

        const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
        expect(stored).toHaveLength(1);
      });
    });
  });

  describe('clearBackendSessions', () => {
    it('removes all sessions for a backend', () => {
      const sessions = [createRemoteSession({ id: 's1' }), createRemoteSession({ id: 's2' })];
      useSessionsStore.getState().setRemoteSessions('backend-1', sessions);

      useSessionsStore.getState().clearBackendSessions('backend-1');

      expect(useSessionsStore.getState().remoteSessions.get('backend-1')).toBeUndefined();
    });

    it('does not affect other backends', () => {
      useSessionsStore.getState().setRemoteSessions('backend-1', [createRemoteSession({ id: 's1' })]);
      useSessionsStore.getState().setRemoteSessions('backend-2', [createRemoteSession({ id: 's2' })]);

      useSessionsStore.getState().clearBackendSessions('backend-1');

      expect(useSessionsStore.getState().remoteSessions.get('backend-1')).toBeUndefined();
      expect(useSessionsStore.getState().remoteSessions.get('backend-2')).toHaveLength(1);
    });

    it('is safe to call for non-existent backend', () => {
      useSessionsStore.getState().clearBackendSessions('nonexistent');

      expect(useSessionsStore.getState().remoteSessions.size).toBe(0);
    });
  });

  describe('clearAllSessions', () => {
    it('removes all sessions across all backends', () => {
      useSessionsStore.getState().setRemoteSessions('backend-1', [createRemoteSession({ id: 's1' })]);
      useSessionsStore.getState().setRemoteSessions('backend-2', [createRemoteSession({ id: 's2' })]);
      useSessionsStore.getState().setRemoteSessions('backend-3', [createRemoteSession({ id: 's3' })]);

      useSessionsStore.getState().clearAllSessions();

      expect(useSessionsStore.getState().remoteSessions.size).toBe(0);
    });

    it('is safe to call when already empty', () => {
      useSessionsStore.getState().clearAllSessions();

      expect(useSessionsStore.getState().remoteSessions.size).toBe(0);
    });
  });
});
