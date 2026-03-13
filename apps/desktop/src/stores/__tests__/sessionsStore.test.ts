import { describe, it, expect, beforeEach } from 'vitest';
import { useSessionsStore, type RemoteSession } from '../sessionsStore';

describe('sessionsStore', () => {
  beforeEach(() => {
    useSessionsStore.setState({
      remoteSessions: new Map(),
      activeSessionIdsByBackend: new Map(),
      recentlyCompletedSessions: [],
    });
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

  describe('reconcileActiveStatus', () => {
    it('marks sessions as active when their IDs are in the active set', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: false });
      const s2 = createRemoteSession({ id: 's2', isActive: false });
      useSessionsStore.getState().setRemoteSessions('backend-1', [s1, s2]);

      useSessionsStore.getState().reconcileActiveStatus('backend-1', new Set(['s1']));

      const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
      expect(stored![0].isActive).toBe(true);
      expect(stored![1].isActive).toBe(false);
    });

    it('marks sessions as inactive when not in the active set', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: true });
      const s2 = createRemoteSession({ id: 's2', isActive: true });
      useSessionsStore.getState().setRemoteSessions('backend-1', [s1, s2]);

      useSessionsStore.getState().reconcileActiveStatus('backend-1', new Set(['s2']));

      const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
      expect(stored![0].isActive).toBe(false);
      expect(stored![1].isActive).toBe(true);
    });

    it('does not update state when nothing changed', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: true });
      const s2 = createRemoteSession({ id: 's2', isActive: false });
      useSessionsStore.getState().setRemoteSessions('backend-1', [s1, s2]);

      const mapBefore = useSessionsStore.getState().remoteSessions;
      useSessionsStore.getState().reconcileActiveStatus('backend-1', new Set(['s1']));
      const mapAfter = useSessionsStore.getState().remoteSessions;

      // Should be the same reference since nothing changed
      expect(mapBefore).toBe(mapAfter);
    });

    it('handles empty active set (all sessions become inactive)', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: true });
      const s2 = createRemoteSession({ id: 's2', isActive: true });
      useSessionsStore.getState().setRemoteSessions('backend-1', [s1, s2]);

      useSessionsStore.getState().reconcileActiveStatus('backend-1', new Set());

      const stored = useSessionsStore.getState().remoteSessions.get('backend-1');
      expect(stored![0].isActive).toBe(false);
      expect(stored![1].isActive).toBe(false);
    });

    it('is safe to call for non-existent backend', () => {
      useSessionsStore.getState().reconcileActiveStatus('non-existent', new Set(['s1']));

      // Should not throw, state unchanged
      expect(useSessionsStore.getState().remoteSessions.size).toBe(0);
    });

    it('does not affect other backends', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: false });
      const s2 = createRemoteSession({ id: 's2', isActive: true });
      useSessionsStore.getState().setRemoteSessions('backend-1', [s1]);
      useSessionsStore.getState().setRemoteSessions('backend-2', [s2]);

      useSessionsStore.getState().reconcileActiveStatus('backend-1', new Set(['s1']));

      const backend1 = useSessionsStore.getState().remoteSessions.get('backend-1');
      const backend2 = useSessionsStore.getState().remoteSessions.get('backend-2');
      expect(backend1![0].isActive).toBe(true);
      expect(backend2![0].isActive).toBe(true); // unchanged
    });

    it('tracks recently completed sessions', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: true });
      useSessionsStore.getState().setRemoteSessions('backend-1', [s1]);

      useSessionsStore.getState().reconcileActiveStatus('backend-1', new Set());

      const completed = useSessionsStore.getState().recentlyCompletedSessions;
      expect(completed).toHaveLength(1);
      expect(completed[0].session.id).toBe('s1');
      expect(completed[0].backendId).toBe('backend-1');
    });
  });

  describe('setActiveSessionsForBackend', () => {
    it('sets active sessions for a backend', () => {
      useSessionsStore.getState().setActiveSessionsForBackend('b1', new Set(['s1', 's2']));
      const active = useSessionsStore.getState().activeSessionIdsByBackend.get('b1');
      expect(active).toEqual(new Set(['s1', 's2']));
    });

    it('skips update when sets are identical', () => {
      useSessionsStore.getState().setActiveSessionsForBackend('b1', new Set(['s1']));
      const before = useSessionsStore.getState().activeSessionIdsByBackend;
      useSessionsStore.getState().setActiveSessionsForBackend('b1', new Set(['s1']));
      const after = useSessionsStore.getState().activeSessionIdsByBackend;
      expect(before).toBe(after);
    });
  });

  describe('setSessionActiveFlag', () => {
    it('adds session to active set', () => {
      useSessionsStore.getState().setSessionActiveFlag('b1', 's1', true);
      const active = useSessionsStore.getState().activeSessionIdsByBackend.get('b1');
      expect(active?.has('s1')).toBe(true);
    });

    it('removes session from active set', () => {
      useSessionsStore.getState().setSessionActiveFlag('b1', 's1', true);
      useSessionsStore.getState().setSessionActiveFlag('b1', 's1', false);
      const active = useSessionsStore.getState().activeSessionIdsByBackend.get('b1');
      expect(active?.has('s1')).toBe(false);
    });

    it('skips update when state unchanged', () => {
      useSessionsStore.getState().setSessionActiveFlag('b1', 's1', true);
      const before = useSessionsStore.getState().activeSessionIdsByBackend;
      useSessionsStore.getState().setSessionActiveFlag('b1', 's1', true);
      const after = useSessionsStore.getState().activeSessionIdsByBackend;
      expect(before).toBe(after);
    });
  });

  describe('setSessionActiveById', () => {
    it('sets session active and updates remoteSessions', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: false });
      useSessionsStore.getState().setRemoteSessions('b1', [s1]);

      useSessionsStore.getState().setSessionActiveById('b1', 's1', true);

      const stored = useSessionsStore.getState().remoteSessions.get('b1');
      expect(stored![0].isActive).toBe(true);
    });

    it('tracks recently completed on deactivation', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: true });
      useSessionsStore.getState().setRemoteSessions('b1', [s1]);

      useSessionsStore.getState().setSessionActiveById('b1', 's1', false);

      const completed = useSessionsStore.getState().recentlyCompletedSessions;
      expect(completed).toHaveLength(1);
      expect(completed[0].session.id).toBe('s1');
    });

    it('handles missing backend gracefully', () => {
      useSessionsStore.getState().setSessionActiveById('missing', 's1', true);
      // Should not throw
      expect(useSessionsStore.getState().activeSessionIdsByBackend.get('missing')).toEqual(new Set(['s1']));
    });

    it('handles missing session id gracefully', () => {
      const s1 = createRemoteSession({ id: 's1' });
      useSessionsStore.getState().setRemoteSessions('b1', [s1]);

      useSessionsStore.getState().setSessionActiveById('b1', 'nonexistent', true);
      // Should not throw, session list unchanged
      const stored = useSessionsStore.getState().remoteSessions.get('b1');
      expect(stored).toHaveLength(1);
    });
  });

  describe('handleSessionEvent active tracking', () => {
    it('tracks active flag on created event', () => {
      const session = createRemoteSession({ id: 's1', isActive: true });
      useSessionsStore.getState().handleSessionEvent('b1', 'created', session);

      const active = useSessionsStore.getState().activeSessionIdsByBackend.get('b1');
      expect(active?.has('s1')).toBe(true);
    });

    it('deduplicates created events', () => {
      const session = createRemoteSession({ id: 's1' });
      useSessionsStore.getState().setRemoteSessions('b1', [session]);

      // Try to create same session again
      const before = useSessionsStore.getState().remoteSessions;
      useSessionsStore.getState().handleSessionEvent('b1', 'created', session);
      const after = useSessionsStore.getState().remoteSessions;
      expect(before).toBe(after); // no change
    });

    it('tracks recently completed on update from active to inactive', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: true });
      useSessionsStore.getState().setRemoteSessions('b1', [s1]);

      const updated = createRemoteSession({ id: 's1', isActive: false });
      useSessionsStore.getState().handleSessionEvent('b1', 'updated', updated);

      const completed = useSessionsStore.getState().recentlyCompletedSessions;
      expect(completed).toHaveLength(1);
    });

    it('removes from active set on delete', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: true });
      useSessionsStore.getState().setRemoteSessions('b1', [s1]);

      useSessionsStore.getState().handleSessionEvent('b1', 'deleted', s1);

      const active = useSessionsStore.getState().activeSessionIdsByBackend.get('b1');
      expect(active?.has('s1')).toBe(false);
    });
  });

  describe('dismissRecentlyCompleted', () => {
    it('removes session from recently completed', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: true });
      useSessionsStore.getState().setRemoteSessions('b1', [s1]);
      useSessionsStore.getState().setSessionActiveById('b1', 's1', false);

      expect(useSessionsStore.getState().recentlyCompletedSessions).toHaveLength(1);

      useSessionsStore.getState().dismissRecentlyCompleted('s1');
      expect(useSessionsStore.getState().recentlyCompletedSessions).toHaveLength(0);
    });
  });

  describe('clearAllRecentlyCompleted', () => {
    it('clears all recently completed sessions', () => {
      const s1 = createRemoteSession({ id: 's1', isActive: true });
      const s2 = createRemoteSession({ id: 's2', isActive: true });
      useSessionsStore.getState().setRemoteSessions('b1', [s1, s2]);
      useSessionsStore.getState().reconcileActiveStatus('b1', new Set());

      expect(useSessionsStore.getState().recentlyCompletedSessions.length).toBeGreaterThan(0);

      useSessionsStore.getState().clearAllRecentlyCompleted();
      expect(useSessionsStore.getState().recentlyCompletedSessions).toHaveLength(0);
    });
  });
});
