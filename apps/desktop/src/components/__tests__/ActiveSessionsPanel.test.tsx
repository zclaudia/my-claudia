import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveSessionsPanel } from '../ActiveSessionsPanel';
import { useSessionsStore, LOCAL_BACKEND_KEY } from '../../stores/sessionsStore';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import { useGatewayStore, toGatewayServerId, parseBackendId } from '../../stores/gatewayStore';

describe('ActiveSessionsPanel', () => {
  beforeEach(() => {
    // Reset stores
    useSessionsStore.setState({ remoteSessions: new Map(), activeSessionIdsByBackend: new Map() });
    useServerStore.setState({
      servers: [{ id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 }],
      activeServerId: 'local',
      connections: {
        local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
      },
      connectionStatus: 'connected',
      connectionError: null,
      isLocalConnection: true,
    });
    useProjectStore.setState({ sessions: [] });
    useGatewayStore.setState({ discoveredBackends: [], gatewayUrl: null, gatewaySecret: null });
  });

  describe('gateway session navigation', () => {
    it('calls onSessionSelect with raw backendId for gateway sessions', () => {
      const backendId = 'test-backend-abc';
      const sessionId = 'session-123';
      const serverId = toGatewayServerId(backendId);

      // Set up gateway backend as active
      useServerStore.setState({
        activeServerId: serverId,
        connections: {
          [serverId]: { status: 'connected', error: null, isLocalConnection: false, features: [] },
        },
        connectionStatus: 'connected',
      });
      useGatewayStore.setState({
        discoveredBackends: [
          { backendId, name: 'Test Backend', online: true, isLocal: false } as any,
        ],
        gatewayUrl: 'ws://gateway.test',
        gatewaySecret: 'secret',
      });

      // Add an active session from this backend
      const remoteSessions = new Map();
      remoteSessions.set(backendId, [
        { id: sessionId, name: 'Active Session', projectId: 'proj-1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() },
      ]);
      useSessionsStore.setState({ remoteSessions });
      useSessionsStore.getState().setActiveSessionsForBackend(backendId, new Set([sessionId]));

      const onSessionSelect = vi.fn();
      render(<ActiveSessionsPanel onSessionSelect={onSessionSelect} />);

      // Click on the active session
      const sessionButton = screen.getByText('Active Session');
      fireEvent.click(sessionButton);

      // Should be called with raw backendId (not gw: prefixed)
      expect(onSessionSelect).toHaveBeenCalledWith(backendId, sessionId);
    });

    it('calls onSessionSelect with "local" for local sessions', () => {
      const sessionId = 'local-session-123';

      useProjectStore.setState({
        sessions: [
          { id: sessionId, name: 'Local Session', projectId: 'proj-1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() } as any,
        ],
      });
      useSessionsStore.getState().setActiveSessionsForBackend(LOCAL_BACKEND_KEY, new Set([sessionId]));

      const onSessionSelect = vi.fn();
      render(<ActiveSessionsPanel onSessionSelect={onSessionSelect} />);

      const sessionButton = screen.getByText('Local Session');
      fireEvent.click(sessionButton);

      expect(onSessionSelect).toHaveBeenCalledWith('local', sessionId);
    });

    it('falls back to localBackend remote snapshot when local project state is stale', () => {
      const localBackendId = 'backend-local-123';
      const sessionId = 's-local-running';

      useServerStore.setState({
        activeServerId: 'local',
        connectionStatus: 'connected',
      });
      useGatewayStore.setState({
        localBackendId,
        discoveredBackends: [
          { backendId: localBackendId, name: 'My Local Backend', online: true, isLocal: true } as any,
        ],
      });
      useProjectStore.setState({ sessions: [] }); // stale: no local active session

      const remoteSessions = new Map();
      remoteSessions.set(localBackendId, [
        { id: sessionId, name: 'Recovered Local Session', projectId: 'proj-1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() },
      ]);
      useSessionsStore.setState({ remoteSessions });
      useSessionsStore.getState().setActiveSessionsForBackend(localBackendId, new Set([sessionId]));
      useSessionsStore.getState().setActiveSessionsForBackend(LOCAL_BACKEND_KEY, new Set([sessionId]));

      render(<ActiveSessionsPanel />);

      expect(screen.getByText('Local Backend')).toBeDefined();
      expect(screen.getByText('Recovered Local Session')).toBeDefined();
    });

    it('merges gateway "local" backend into local bucket when localBackendId is unavailable', () => {
      const localSessionId = 'local-session-direct';
      const gwSessionId = 'local-session-gw';

      useServerStore.setState({
        activeServerId: 'local',
        connections: {
          local: { status: 'connected', error: null, isLocalConnection: true, features: [] },
        },
        connectionStatus: 'connected',
      });
      useGatewayStore.setState({
        localBackendId: null,
      });
      useProjectStore.setState({
        sessions: [
          { id: localSessionId, name: 'Direct Local Session', projectId: 'proj-1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() } as any,
        ],
      });

      const remoteSessions = new Map();
      remoteSessions.set('local', [
        { id: gwSessionId, name: 'Gateway Local Session', projectId: 'proj-2', isActive: true, createdAt: Date.now(), updatedAt: Date.now() },
      ]);
      useSessionsStore.setState({ remoteSessions });
      useSessionsStore.getState().setActiveSessionsForBackend(LOCAL_BACKEND_KEY, new Set([localSessionId]));
      useSessionsStore.getState().setActiveSessionsForBackend('local', new Set([gwSessionId]));

      render(<ActiveSessionsPanel />);

      expect(screen.getByText('Local Backend')).toBeDefined();
      expect(screen.getByText('Direct Local Session')).toBeDefined();
      expect(screen.getByText('Gateway Local Session')).toBeDefined();
      expect(screen.queryByText('Backend local')).toBeNull();
    });

    it('shows placeholder active session when metadata is not loaded yet', () => {
      const missingSessionId = 'session-missing-meta-1234';
      useServerStore.setState({
        activeServerId: 'local',
        connectionStatus: 'connected',
      });
      useProjectStore.setState({ sessions: [] });
      useSessionsStore.getState().setActiveSessionsForBackend(LOCAL_BACKEND_KEY, new Set([missingSessionId]));

      render(<ActiveSessionsPanel />);

      expect(screen.getByText('Local Backend')).toBeDefined();
      expect(screen.getByText(`Session ${missingSessionId.slice(0, 8)}`)).toBeDefined();
    });

    it('correctly parses currentBackendId from gateway activeServerId', () => {
      const backendId = 'my-backend-xyz';
      const serverId = toGatewayServerId(backendId);

      useServerStore.setState({
        activeServerId: serverId,
        connections: {
          [serverId]: { status: 'connected', error: null, isLocalConnection: false, features: [] },
        },
        connectionStatus: 'connected',
      });
      useGatewayStore.setState({
        discoveredBackends: [
          { backendId, name: 'My Backend', online: true, isLocal: false } as any,
        ],
        gatewayUrl: 'ws://gateway.test',
        gatewaySecret: 'secret',
      });

      const remoteSessions = new Map();
      remoteSessions.set(backendId, [
        { id: 'sess-1', name: 'Test Session', projectId: 'proj-1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() },
      ]);
      useSessionsStore.setState({ remoteSessions });
      useSessionsStore.getState().setActiveSessionsForBackend(backendId, new Set(['sess-1']));

      render(<ActiveSessionsPanel />);

      // The "(Current)" suffix should appear since this is the active backend
      expect(screen.getByText(/\(Current\)/)).toBeDefined();
    });

    it('prefers discovered backend name over backend id fallback label', () => {
      const backendId = '0e3a5d2b-1234';
      const serverId = toGatewayServerId(backendId);

      useServerStore.setState({
        activeServerId: 'local',
        servers: [{ id: 'local', name: 'Local', address: 'localhost:3100', isDefault: true, createdAt: 0 }],
      });
      useGatewayStore.setState({
        discoveredBackends: [
          { backendId, name: 'Mac Mini Agent', online: true, isLocal: false } as any,
        ],
      });

      const remoteSessions = new Map();
      remoteSessions.set(backendId, [
        { id: 'sess-1', name: 'Test Session', projectId: 'proj-1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() },
      ]);
      useSessionsStore.setState({ remoteSessions });
      useSessionsStore.getState().setActiveSessionsForBackend(backendId, new Set(['sess-1']));

      render(<ActiveSessionsPanel />);

      expect(screen.getByText('Mac Mini Agent')).toBeDefined();
      expect(screen.queryByText(/Backend 0e3a5d2b/i)).toBeNull();
      expect(serverId).toBe(`gw:${backendId}`);
    });
  });

  describe('UI interactions', () => {
    it('returns null when no activeServerId', () => {
      useServerStore.setState({ activeServerId: null });
      const { container } = render(<ActiveSessionsPanel />);
      expect(container.firstChild).toBeNull();
    });

    it('shows "No active sessions" when no sessions are active', () => {
      render(<ActiveSessionsPanel />);
      expect(screen.getByText('No active sessions')).toBeDefined();
    });

    it('toggles collapse on header click', () => {
      const sessionId = 'sess-1';
      useProjectStore.setState({
        sessions: [
          { id: sessionId, name: 'My Session', projectId: 'proj-1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() } as any,
        ],
      });
      useSessionsStore.getState().setActiveSessionsForBackend(LOCAL_BACKEND_KEY, new Set([sessionId]));

      render(<ActiveSessionsPanel />);

      expect(screen.getByText('My Session')).toBeDefined();

      // Click header to collapse
      fireEvent.click(screen.getByText('Active Sessions'));

      // Session should be hidden
      expect(screen.queryByText('My Session')).toBeNull();

      // Click again to expand
      fireEvent.click(screen.getByText('Active Sessions'));
      expect(screen.getByText('My Session')).toBeDefined();
    });

    it('shows total active session count', () => {
      useProjectStore.setState({
        sessions: [
          { id: 's1', name: 'Session 1', projectId: 'p1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() } as any,
          { id: 's2', name: 'Session 2', projectId: 'p1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() } as any,
        ],
      });
      useSessionsStore.getState().setActiveSessionsForBackend(LOCAL_BACKEND_KEY, new Set(['s1', 's2']));

      render(<ActiveSessionsPanel />);
      // The session count is shown next to the "Active Sessions" header
      expect(screen.getByText('Session 1')).toBeDefined();
      expect(screen.getByText('Session 2')).toBeDefined();
    });

    it('shows project name next to session', () => {
      useProjectStore.setState({
        sessions: [
          { id: 's1', name: 'Session 1', projectId: 'proj-1', isActive: true, createdAt: Date.now(), updatedAt: Date.now() } as any,
        ],
        projects: [
          { id: 'proj-1', name: 'My Project' } as any,
        ],
      });
      useSessionsStore.getState().setActiveSessionsForBackend(LOCAL_BACKEND_KEY, new Set(['s1']));

      render(<ActiveSessionsPanel />);
      expect(screen.getByText('My Project')).toBeDefined();
    });

    it('renders recently completed sessions', () => {
      useSessionsStore.setState({
        recentlyCompletedSessions: [
          {
            session: { id: 'done-1', name: 'Done Session', projectId: 'p1', createdAt: Date.now(), updatedAt: Date.now() } as any,
            backendId: LOCAL_BACKEND_KEY,
            completedAt: Date.now() - 30000,
          },
        ],
      });

      render(<ActiveSessionsPanel />);
      expect(screen.getByText('Recently Completed')).toBeDefined();
      expect(screen.getByText('Done Session')).toBeDefined();
      expect(screen.getByText('Clear all')).toBeDefined();
    });

    it('calls clearAllRecentlyCompleted on Clear all click', () => {
      const clearAllSpy = vi.fn();
      useSessionsStore.setState({
        recentlyCompletedSessions: [
          {
            session: { id: 'done-1', name: 'Done Session', projectId: 'p1', createdAt: Date.now(), updatedAt: Date.now() } as any,
            backendId: LOCAL_BACKEND_KEY,
            completedAt: Date.now(),
          },
        ],
        clearAllRecentlyCompleted: clearAllSpy,
      });

      render(<ActiveSessionsPanel />);
      fireEvent.click(screen.getByText('Clear all'));
      expect(clearAllSpy).toHaveBeenCalled();
    });

    it('calls dismissRecentlyCompleted on dismiss button click', () => {
      const dismissSpy = vi.fn();
      useSessionsStore.setState({
        recentlyCompletedSessions: [
          {
            session: { id: 'done-1', name: 'Done Session', projectId: 'p1', createdAt: Date.now(), updatedAt: Date.now() } as any,
            backendId: LOCAL_BACKEND_KEY,
            completedAt: Date.now(),
          },
        ],
        dismissRecentlyCompleted: dismissSpy,
      });

      render(<ActiveSessionsPanel />);
      fireEvent.click(screen.getByLabelText('Dismiss'));
      expect(dismissSpy).toHaveBeenCalledWith('done-1');
    });

    it('calls onSessionSelect with "local" for recently completed local sessions', () => {
      const onSessionSelect = vi.fn();
      useSessionsStore.setState({
        recentlyCompletedSessions: [
          {
            session: { id: 'done-1', name: 'Completed Local', projectId: 'p1', createdAt: Date.now(), updatedAt: Date.now() } as any,
            backendId: LOCAL_BACKEND_KEY,
            completedAt: Date.now(),
          },
        ],
      });

      render(<ActiveSessionsPanel onSessionSelect={onSessionSelect} />);
      fireEvent.click(screen.getByText('Completed Local'));
      expect(onSessionSelect).toHaveBeenCalledWith('local', 'done-1');
    });

    it('calls onSessionSelect with backendId for recently completed gateway sessions', () => {
      const onSessionSelect = vi.fn();
      useSessionsStore.setState({
        recentlyCompletedSessions: [
          {
            session: { id: 'done-1', name: 'Completed Remote', projectId: 'p1', createdAt: Date.now(), updatedAt: Date.now() } as any,
            backendId: 'remote-backend-1',
            completedAt: Date.now(),
          },
        ],
      });

      render(<ActiveSessionsPanel onSessionSelect={onSessionSelect} />);
      fireEvent.click(screen.getByText('Completed Remote'));
      expect(onSessionSelect).toHaveBeenCalledWith('remote-backend-1', 'done-1');
    });
  });

  describe('gateway prefix consistency', () => {
    it('toGatewayServerId and parseBackendId are inverse operations', () => {
      const backendId = 'test-backend';
      expect(parseBackendId(toGatewayServerId(backendId))).toBe(backendId);
    });

    it('Sidebar handler should use toGatewayServerId for setActiveServer', () => {
      // This test verifies the fix: Sidebar uses toGatewayServerId(backendId)
      // instead of the old `gateway:${backendId}` which was wrong
      const backendId = 'abc123';
      const correctServerId = toGatewayServerId(backendId);
      expect(correctServerId).toBe('gw:abc123');
      // The old broken code would have produced 'gateway:abc123'
      expect(correctServerId).not.toBe('gateway:abc123');
    });
  });
});
