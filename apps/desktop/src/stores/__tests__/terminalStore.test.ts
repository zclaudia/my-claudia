import { describe, it, expect, beforeEach } from 'vitest';
import { useTerminalStore } from '../terminalStore';

describe('terminalStore', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      terminals: {},
      isDrawerOpen: false,
    });
  });

  describe('initial state', () => {
    it('has empty terminals and closed drawer', () => {
      const state = useTerminalStore.getState();
      expect(state.terminals).toEqual({});
      expect(state.isDrawerOpen).toBe(false);
    });
  });

  describe('openTerminal', () => {
    it('creates a new terminal for a project', () => {
      const terminalId = useTerminalStore.getState().openTerminal('project-1');

      expect(terminalId).toBeTruthy();
      expect(useTerminalStore.getState().terminals['project-1']).toBe(terminalId);
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
  });

  describe('closeTerminal', () => {
    it('removes the terminal mapping', () => {
      const terminalId = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().closeTerminal(terminalId);

      expect(useTerminalStore.getState().terminals['project-1']).toBeUndefined();
    });

    it('does not affect other terminals', () => {
      const id1 = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().openTerminal('project-2');

      useTerminalStore.getState().closeTerminal(id1);

      expect(useTerminalStore.getState().terminals['project-1']).toBeUndefined();
      expect(useTerminalStore.getState().terminals['project-2']).toBeTruthy();
    });

    it('is safe to call with non-existent terminal ID', () => {
      useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().closeTerminal('non-existent');

      expect(Object.keys(useTerminalStore.getState().terminals)).toHaveLength(1);
    });
  });

  describe('setDrawerOpen', () => {
    it('opens the drawer', () => {
      useTerminalStore.getState().setDrawerOpen(true);
      expect(useTerminalStore.getState().isDrawerOpen).toBe(true);
    });

    it('closes the drawer', () => {
      useTerminalStore.getState().setDrawerOpen(true);
      useTerminalStore.getState().setDrawerOpen(false);
      expect(useTerminalStore.getState().isDrawerOpen).toBe(false);
    });
  });

  describe('handleTerminalExited', () => {
    it('removes the exited terminal mapping', () => {
      const terminalId = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().handleTerminalExited(terminalId);

      expect(useTerminalStore.getState().terminals['project-1']).toBeUndefined();
    });

    it('allows opening a new terminal for the same project after exit', () => {
      const first = useTerminalStore.getState().openTerminal('project-1');
      useTerminalStore.getState().handleTerminalExited(first);

      const second = useTerminalStore.getState().openTerminal('project-1');
      expect(second).not.toBe(first);
      expect(useTerminalStore.getState().terminals['project-1']).toBe(second);
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
});
