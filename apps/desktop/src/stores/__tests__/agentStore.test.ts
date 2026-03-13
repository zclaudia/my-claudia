import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore } from '../agentStore';

describe('agentStore', () => {
  beforeEach(() => {
    useAgentStore.getState().reset();
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      useAgentStore.getState().setExpanded(true);
      useAgentStore.getState().setHasUnread(true);
      useAgentStore.getState().setLoading(true);

      useAgentStore.getState().reset();

      const state = useAgentStore.getState();
      expect(state.isExpanded).toBe(false);
      expect(state.hasUnread).toBe(false);
      expect(state.isLoading).toBe(false);
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

  describe('requestClear', () => {
    it('increments clearRequestId', () => {
      expect(useAgentStore.getState().clearRequestId).toBe(0);
      useAgentStore.getState().requestClear();
      expect(useAgentStore.getState().clearRequestId).toBe(1);
      useAgentStore.getState().requestClear();
      expect(useAgentStore.getState().clearRequestId).toBe(2);
    });
  });
});
