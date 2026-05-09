import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getTerminalScopeKey, useTerminalStore } from '../terminalStore';
import { usePluginStore } from '../pluginStore';
import { useServerStore } from '../serverStore';

describe('terminalStore', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      terminals: {},
      readyTerminals: new Set(),
      drawerOpen: {},
      ctrlActive: {},
    });
    useServerStore.setState({
      activeServerId: 'backend-1',
      connections: {},
      localServerPort: null,
      controlPlaneMode: 'gateway-direct',
    });
    // Register terminal panel for visibility sync tests
    usePluginStore.setState({ panels: [] });
  });

  describe('initial state', () => {
    it('has empty terminals and closed drawer', () => {
      const state = useTerminalStore.getState();
      expect(state.terminals).toEqual({});
      expect(state.isDrawerOpen('any-project')).toBe(false);
    });
  });

  describe('openTerminal', () => {
    it('creates a new terminal for a project', () => {
      const terminalId = useTerminalStore.getState().openTerminal('project-1');

      expect(terminalId).toBeTruthy();
      expect(useTerminalStore.getState().terminals[getTerminalScopeKey('project-1', 'backend-1')]).toBe(terminalId);
    });

    it('returns existing terminal if project already has one', () => {
      const first = useTerminalStore.getState().openTerminal('project-1');
      const second = useTerminalStore.getState().openTerminal('project-1');

      expect(first).toBe(second);
    });

    it('creates separate terminals for different projects', () => {
      const id1 = useTerminalStore.getState().openTerminal('project-1');
      const id2 = useTerminalStore.getState().openTerminal('project-2');

      expect(id1).not.toBe(id2);
      expect(Object.keys(useTerminalStore.getState().terminals)).toHaveLength(2);
    });

    it('creates separate terminals for the same project on different backends', () => {
      const id1 = useTerminalStore.getState().openTerminal('project-1', 'backend-1');
      const id2 = useTerminalStore.getState().openTerminal('project-1', 'backend-2');

      expect(id1).not.toBe(id2);
      expect(useTerminalStore.getState().getTerminalId('project-1', 'backend-1')).toBe(id1);
      expect(useTerminalStore.getState().getTerminalId('project-1', 'backend-2')).toBe(id2);
    });
  });

  describe('closeTerminal', () => {
    it('removes the terminal mapping', () => {
      const terminalId = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().closeTerminal(terminalId);

      expect(useTerminalStore.getState().terminals[getTerminalScopeKey('project-1', 'backend-1')]).toBeUndefined();
    });

    it('does not affect other terminals', () => {
      const id1 = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().openTerminal('project-2');

      useTerminalStore.getState().closeTerminal(id1);

      expect(useTerminalStore.getState().terminals[getTerminalScopeKey('project-1', 'backend-1')]).toBeUndefined();
      expect(useTerminalStore.getState().terminals[getTerminalScopeKey('project-2', 'backend-1')]).toBeTruthy();
    });

    it('is safe to call with non-existent terminal ID', () => {
      useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().closeTerminal('non-existent');

      expect(Object.keys(useTerminalStore.getState().terminals)).toHaveLength(1);
    });
  });

  describe('setDrawerOpen', () => {
    it('opens the drawer for a project', () => {
      useTerminalStore.getState().setDrawerOpen('project-1', true);
      expect(useTerminalStore.getState().isDrawerOpen('project-1')).toBe(true);
    });

    it('closes the drawer for a project', () => {
      useTerminalStore.getState().setDrawerOpen('project-1', true);
      useTerminalStore.getState().setDrawerOpen('project-1', false);
      expect(useTerminalStore.getState().isDrawerOpen('project-1')).toBe(false);
    });

    it('keeps drawer state independent per project', () => {
      useTerminalStore.getState().setDrawerOpen('project-1', true);
      useTerminalStore.getState().setDrawerOpen('project-2', false);
      expect(useTerminalStore.getState().isDrawerOpen('project-1')).toBe(true);
      expect(useTerminalStore.getState().isDrawerOpen('project-2')).toBe(false);
    });

    it('keeps drawer state independent per backend for the same project', () => {
      useTerminalStore.getState().setDrawerOpen('project-1', true, 'backend-1');
      useTerminalStore.getState().setDrawerOpen('project-1', false, 'backend-2');
      expect(useTerminalStore.getState().isDrawerOpen('project-1', 'backend-1')).toBe(true);
      expect(useTerminalStore.getState().isDrawerOpen('project-1', 'backend-2')).toBe(false);
    });
  });

  describe('handleTerminalExited', () => {
    it('removes the exited terminal mapping', () => {
      const terminalId = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().handleTerminalExited(terminalId);

      expect(useTerminalStore.getState().terminals[getTerminalScopeKey('project-1', 'backend-1')]).toBeUndefined();
    });

    it('allows opening a new terminal for the same project after exit', () => {
      const first = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().handleTerminalExited(first);

      const second = useTerminalStore.getState().openTerminal('project-1');
      expect(second).not.toBe(first);
      expect(useTerminalStore.getState().terminals[getTerminalScopeKey('project-1', 'backend-1')]).toBe(second);
    });

    it('is safe to call with non-existent terminal ID', () => {
      useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().handleTerminalExited('non-existent');

      expect(Object.keys(useTerminalStore.getState().terminals)).toHaveLength(1);
    });
  });

  describe('getTerminalId', () => {
    it('returns terminal ID for a project with a terminal', () => {
      const terminalId = useTerminalStore.getState().openTerminal('project-1');
      expect(useTerminalStore.getState().getTerminalId('project-1')).toBe(terminalId);
    });

    it('returns undefined for a project without a terminal', () => {
      expect(useTerminalStore.getState().getTerminalId('project-1')).toBeUndefined();
    });
  });

  describe('toggleCtrl', () => {
    it('toggles ctrl active state', () => {
      const tid = useTerminalStore.getState().openTerminal('project-1');
      expect(useTerminalStore.getState().ctrlActive[tid]).toBeFalsy();

      useTerminalStore.getState().toggleCtrl(tid);
      expect(useTerminalStore.getState().ctrlActive[tid]).toBe(true);

      useTerminalStore.getState().toggleCtrl(tid);
      expect(useTerminalStore.getState().ctrlActive[tid]).toBe(false);
    });
  });

  describe('markReady / isReady', () => {
    it('marks terminal as ready', () => {
      const tid = useTerminalStore.getState().openTerminal('project-1');
      expect(useTerminalStore.getState().isReady(tid)).toBe(false);

      useTerminalStore.getState().markReady(tid);
      expect(useTerminalStore.getState().isReady(tid)).toBe(true);
    });

    it('is idempotent', () => {
      const tid = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().markReady(tid);
      const before = useTerminalStore.getState().readyTerminals;
      useTerminalStore.getState().markReady(tid);
      expect(useTerminalStore.getState().readyTerminals).toBe(before);
    });

    it('removes ready state on close', () => {
      const tid = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().markReady(tid);
      useTerminalStore.getState().closeTerminal(tid);
      expect(useTerminalStore.getState().isReady(tid)).toBe(false);
    });
  });

  describe('setDrawerOpen syncs pluginStore visibility', () => {
    it('updates terminal panel visibility in pluginStore', () => {
      // Register a terminal panel first
      usePluginStore.getState().registerPanel({
        id: 'terminal',
        pluginId: 'com.claudia.terminal',
        type: 'panel',
        label: 'Terminal',
        visible: false,
      });

      useTerminalStore.getState().setDrawerOpen('project-1', true);
      const panel = usePluginStore.getState().panels.find(p => p.id === 'terminal');
      expect(panel?.visible).toBe(true);

      useTerminalStore.getState().setDrawerOpen('project-1', false);
      const panel2 = usePluginStore.getState().panels.find(p => p.id === 'terminal');
      expect(panel2?.visible).toBe(false);
    });
  });

  describe('waitForReady', () => {
    it('resolves immediately if already ready', async () => {
      const tid = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().markReady(tid);

      const result = await useTerminalStore.getState().waitForReady(tid);
      expect(result).toBe(true);
    });

    it('resolves when terminal becomes ready', async () => {
      const tid = useTerminalStore.getState().openTerminal('project-1');

      const promise = useTerminalStore.getState().waitForReady(tid, 5000);
      // Mark ready after a tick
      setTimeout(() => useTerminalStore.getState().markReady(tid), 10);

      const result = await promise;
      expect(result).toBe(true);
    });

    it('resolves false on timeout', async () => {
      vi.useFakeTimers();
      const tid = useTerminalStore.getState().openTerminal('project-1');

      const promise = useTerminalStore.getState().waitForReady(tid, 100);
      await vi.advanceTimersByTimeAsync(150);

      const result = await promise;
      expect(result).toBe(false);
      vi.useRealTimers();
    });
  });

  // Reattach recovery state was removed in the phase 7 cleanup. The equivalent contract is
  // now owned by TerminalController (see services/terminal/__tests__/TerminalController.test.ts).
});
