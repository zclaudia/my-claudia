import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore, type BackgroundSessionInfo } from '../agentStore';
import type { AgentPermissionPolicy } from '@my-claudia/shared';

const initialState = {
  agentSessionId: null,
  agentProjectId: null,
  isConfigured: false,
  isExpanded: false,
  hasUnread: false,
  selectedProviderId: null,
  activeRunId: null,
  isLoading: false,
  interceptionCount: 0,
  lastInterception: null,
  permissionPolicy: null,
  backgroundSessions: {},
};

describe('agentStore', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  describe('configure', () => {
    it('sets projectId, sessionId, and isConfigured', () => {
      useAgentStore.getState().configure('project-1', 'session-1');

      const state = useAgentStore.getState();
      expect(state.agentProjectId).toBe('project-1');
      expect(state.agentSessionId).toBe('session-1');
      expect(state.isConfigured).toBe(true);
    });

    it('can reconfigure with different values', () => {
      useAgentStore.getState().configure('project-1', 'session-1');
      useAgentStore.getState().configure('project-2', 'session-2');

      const state = useAgentStore.getState();
      expect(state.agentProjectId).toBe('project-2');
      expect(state.agentSessionId).toBe('session-2');
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useAgentStore.getState().configure('project-1', 'session-1');
      useAgentStore.getState().setExpanded(true);
      useAgentStore.getState().setHasUnread(true);
      useAgentStore.getState().setLoading(true);
      useAgentStore.getState().setActiveRunId('run-1');
      useAgentStore.getState().setSelectedProviderId('provider-1');
      useAgentStore.getState().recordInterception('Bash', 'allow', 'session-1');

      useAgentStore.getState().reset();

      const state = useAgentStore.getState();
      expect(state.agentSessionId).toBeNull();
      expect(state.agentProjectId).toBeNull();
      expect(state.isConfigured).toBe(false);
      expect(state.isExpanded).toBe(false);
      expect(state.hasUnread).toBe(false);
      expect(state.isLoading).toBe(false);
      expect(state.activeRunId).toBeNull();
      expect(state.selectedProviderId).toBeNull();
      expect(state.interceptionCount).toBe(0);
      expect(state.lastInterception).toBeNull();
      expect(state.permissionPolicy).toBeNull();
      expect(state.backgroundSessions).toEqual({});
    });
  });

  describe('toggleExpanded', () => {
    it('toggles from false to true', () => {
      useAgentStore.getState().toggleExpanded();
      expect(useAgentStore.getState().isExpanded).toBe(true);
    });

    it('toggles from true to false', () => {
      useAgentStore.getState().setExpanded(true);
      useAgentStore.getState().toggleExpanded();
      expect(useAgentStore.getState().isExpanded).toBe(false);
    });

    it('toggles back and forth', () => {
      useAgentStore.getState().toggleExpanded();
      useAgentStore.getState().toggleExpanded();
      expect(useAgentStore.getState().isExpanded).toBe(false);
    });
  });

  describe('setExpanded', () => {
    it('sets isExpanded to true', () => {
      useAgentStore.getState().setExpanded(true);
      expect(useAgentStore.getState().isExpanded).toBe(true);
    });

    it('sets isExpanded to false', () => {
      useAgentStore.getState().setExpanded(true);
      useAgentStore.getState().setExpanded(false);
      expect(useAgentStore.getState().isExpanded).toBe(false);
    });
  });

  describe('setHasUnread', () => {
    it('sets hasUnread to true', () => {
      useAgentStore.getState().setHasUnread(true);
      expect(useAgentStore.getState().hasUnread).toBe(true);
    });

    it('sets hasUnread to false', () => {
      useAgentStore.getState().setHasUnread(true);
      useAgentStore.getState().setHasUnread(false);
      expect(useAgentStore.getState().hasUnread).toBe(false);
    });
  });

  describe('setSelectedProviderId', () => {
    it('sets provider id', () => {
      useAgentStore.getState().setSelectedProviderId('provider-1');
      expect(useAgentStore.getState().selectedProviderId).toBe('provider-1');
    });

    it('sets provider id to null', () => {
      useAgentStore.getState().setSelectedProviderId('provider-1');
      useAgentStore.getState().setSelectedProviderId(null);
      expect(useAgentStore.getState().selectedProviderId).toBeNull();
    });
  });

  describe('setActiveRunId', () => {
    it('sets active run id', () => {
      useAgentStore.getState().setActiveRunId('run-1');
      expect(useAgentStore.getState().activeRunId).toBe('run-1');
    });

    it('clears active run id with null', () => {
      useAgentStore.getState().setActiveRunId('run-1');
      useAgentStore.getState().setActiveRunId(null);
      expect(useAgentStore.getState().activeRunId).toBeNull();
    });
  });

  describe('setLoading', () => {
    it('sets loading to true', () => {
      useAgentStore.getState().setLoading(true);
      expect(useAgentStore.getState().isLoading).toBe(true);
    });

    it('sets loading to false', () => {
      useAgentStore.getState().setLoading(true);
      useAgentStore.getState().setLoading(false);
      expect(useAgentStore.getState().isLoading).toBe(false);
    });
  });

  describe('updatePermissionPolicy', () => {
    it('sets permission policy', () => {
      const policy: AgentPermissionPolicy = {
        enabled: true,
        trustLevel: 'moderate',
      };
      useAgentStore.getState().updatePermissionPolicy(policy);
      expect(useAgentStore.getState().permissionPolicy).toEqual(policy);
    });

    it('replaces existing policy', () => {
      const policy1: AgentPermissionPolicy = { enabled: true, trustLevel: 'conservative' };
      const policy2: AgentPermissionPolicy = { enabled: false, trustLevel: 'aggressive' };

      useAgentStore.getState().updatePermissionPolicy(policy1);
      useAgentStore.getState().updatePermissionPolicy(policy2);

      expect(useAgentStore.getState().permissionPolicy).toEqual(policy2);
    });
  });

  describe('recordInterception', () => {
    it('increments interception count and sets lastInterception', () => {
      useAgentStore.getState().recordInterception('Bash', 'deny', 'session-1');

      const state = useAgentStore.getState();
      expect(state.interceptionCount).toBe(1);
      expect(state.lastInterception).toEqual({
        toolName: 'Bash',
        decision: 'deny',
        sessionId: 'session-1',
      });
    });

    it('accumulates interception count over multiple calls', () => {
      useAgentStore.getState().recordInterception('Bash', 'deny', 'session-1');
      useAgentStore.getState().recordInterception('Write', 'allow', 'session-2');
      useAgentStore.getState().recordInterception('Read', 'deny', 'session-1');

      const state = useAgentStore.getState();
      expect(state.interceptionCount).toBe(3);
      expect(state.lastInterception).toEqual({
        toolName: 'Read',
        decision: 'deny',
        sessionId: 'session-1',
      });
    });
  });

  describe('updateBackgroundSession', () => {
    it('creates a new background session with defaults', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { name: 'Task 1' });

      const session = useAgentStore.getState().backgroundSessions['bg-1'];
      expect(session).toBeDefined();
      expect(session.sessionId).toBe('bg-1');
      expect(session.name).toBe('Task 1');
      expect(session.status).toBe('running');
      expect(session.pendingPermissions).toEqual([]);
    });

    it('updates an existing background session', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { name: 'Task 1', status: 'running' });
      useAgentStore.getState().updateBackgroundSession('bg-1', { status: 'completed' });

      const session = useAgentStore.getState().backgroundSessions['bg-1'];
      expect(session.status).toBe('completed');
      expect(session.name).toBe('Task 1');
    });

    it('preserves sessionId even when update does not include it', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { status: 'paused' });

      expect(useAgentStore.getState().backgroundSessions['bg-1'].sessionId).toBe('bg-1');
    });
  });

  describe('addBackgroundPermission', () => {
    const permission = {
      requestId: 'req-1',
      toolName: 'Bash',
      detail: '{"command": "rm -rf /tmp/test"}',
      timeoutSeconds: 60,
    };

    it('adds a permission to an existing background session', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { status: 'running' });
      useAgentStore.getState().addBackgroundPermission('bg-1', permission);

      const session = useAgentStore.getState().backgroundSessions['bg-1'];
      expect(session.pendingPermissions).toHaveLength(1);
      expect(session.pendingPermissions[0]).toEqual(permission);
    });

    it('appends multiple permissions', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { status: 'running' });
      useAgentStore.getState().addBackgroundPermission('bg-1', permission);
      useAgentStore.getState().addBackgroundPermission('bg-1', { ...permission, requestId: 'req-2' });

      const session = useAgentStore.getState().backgroundSessions['bg-1'];
      expect(session.pendingPermissions).toHaveLength(2);
    });

    it('does nothing if background session does not exist', () => {
      useAgentStore.getState().addBackgroundPermission('nonexistent', permission);

      expect(useAgentStore.getState().backgroundSessions['nonexistent']).toBeUndefined();
    });
  });

  describe('removeBackgroundPermission', () => {
    const permission1 = {
      requestId: 'req-1',
      toolName: 'Bash',
      detail: '{"command": "ls"}',
      timeoutSeconds: 60,
    };
    const permission2 = {
      requestId: 'req-2',
      toolName: 'Write',
      detail: '{"path": "/tmp/test"}',
      timeoutSeconds: 30,
    };

    it('removes a specific permission by requestId', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { status: 'running' });
      useAgentStore.getState().addBackgroundPermission('bg-1', permission1);
      useAgentStore.getState().addBackgroundPermission('bg-1', permission2);

      useAgentStore.getState().removeBackgroundPermission('bg-1', 'req-1');

      const session = useAgentStore.getState().backgroundSessions['bg-1'];
      expect(session.pendingPermissions).toHaveLength(1);
      expect(session.pendingPermissions[0].requestId).toBe('req-2');
    });

    it('does nothing if background session does not exist', () => {
      useAgentStore.getState().removeBackgroundPermission('nonexistent', 'req-1');

      expect(useAgentStore.getState().backgroundSessions['nonexistent']).toBeUndefined();
    });

    it('does nothing if requestId does not match', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { status: 'running' });
      useAgentStore.getState().addBackgroundPermission('bg-1', permission1);

      useAgentStore.getState().removeBackgroundPermission('bg-1', 'nonexistent-req');

      expect(useAgentStore.getState().backgroundSessions['bg-1'].pendingPermissions).toHaveLength(1);
    });
  });

  describe('removeBackgroundSession', () => {
    it('removes a background session', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { status: 'running' });
      useAgentStore.getState().removeBackgroundSession('bg-1');

      expect(useAgentStore.getState().backgroundSessions['bg-1']).toBeUndefined();
    });

    it('does not affect other background sessions', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { status: 'running' });
      useAgentStore.getState().updateBackgroundSession('bg-2', { status: 'paused' });

      useAgentStore.getState().removeBackgroundSession('bg-1');

      expect(useAgentStore.getState().backgroundSessions['bg-1']).toBeUndefined();
      expect(useAgentStore.getState().backgroundSessions['bg-2']).toBeDefined();
    });

    it('does nothing when removing non-existent session', () => {
      useAgentStore.getState().updateBackgroundSession('bg-1', { status: 'running' });
      useAgentStore.getState().removeBackgroundSession('bg-nonexistent');

      expect(useAgentStore.getState().backgroundSessions['bg-1']).toBeDefined();
    });
  });
});
