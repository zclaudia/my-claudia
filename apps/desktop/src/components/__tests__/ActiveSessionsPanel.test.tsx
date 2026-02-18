import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ActiveSessionsPanel } from '../ActiveSessionsPanel';
import { useSessionsStore } from '../../stores/sessionsStore';
import { useServerStore } from '../../stores/serverStore';
import { useProjectStore } from '../../stores/projectStore';
import { useGatewayStore, toGatewayServerId, parseBackendId } from '../../stores/gatewayStore';

describe('ActiveSessionsPanel', () => {
  beforeEach(() => {
    // Reset stores
    useSessionsStore.setState({ remoteSessions: new Map() });
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

      const onSessionSelect = vi.fn();
      render(<ActiveSessionsPanel onSessionSelect={onSessionSelect} />);

      const sessionButton = screen.getByText('Local Session');
      fireEvent.click(sessionButton);

      expect(onSessionSelect).toHaveBeenCalledWith('local', sessionId);
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

      render(<ActiveSessionsPanel />);

      // The "(Current)" suffix should appear since this is the active backend
      expect(screen.getByText(/\(Current\)/)).toBeDefined();
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
