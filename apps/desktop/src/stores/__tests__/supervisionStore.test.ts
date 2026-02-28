import { describe, it, expect, beforeEach } from 'vitest';
import { useSupervisionStore } from '../supervisionStore';
import type { Supervision } from '@my-claudia/shared';

describe('supervisionStore', () => {
  beforeEach(() => {
    useSupervisionStore.setState({ supervisions: {} });
  });

  const createSupervision = (overrides: Partial<Supervision> = {}): Supervision => ({
    id: 'sup-1',
    sessionId: 'session-1',
    goal: 'Test goal',
    status: 'active',
    maxIterations: 10,
    currentIteration: 0,
    cooldownSeconds: 30,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  });

  describe('setSupervision', () => {
    it('sets a supervision for a session', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);

      expect(useSupervisionStore.getState().supervisions['session-1']).toEqual(supervision);
    });

    it('replaces existing supervision for same session', () => {
      const old = createSupervision({ goal: 'Old goal' });
      const updated = createSupervision({ goal: 'New goal' });

      useSupervisionStore.getState().setSupervision('session-1', old);
      useSupervisionStore.getState().setSupervision('session-1', updated);

      expect(useSupervisionStore.getState().supervisions['session-1'].goal).toBe('New goal');
    });

    it('removes supervision when called with null', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);
      useSupervisionStore.getState().setSupervision('session-1', null);

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
    });

    it('does not affect other sessions', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);

      expect(useSupervisionStore.getState().supervisions['session-1']).toEqual(sup1);
      expect(useSupervisionStore.getState().supervisions['session-2']).toEqual(sup2);
    });

    it('removing one session does not affect others', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);
      useSupervisionStore.getState().setSupervision('session-1', null);

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
      expect(useSupervisionStore.getState().supervisions['session-2']).toEqual(sup2);
    });
  });

  describe('updateSupervision', () => {
    it('updates an existing supervision', () => {
      const supervision = createSupervision({ currentIteration: 0 });
      useSupervisionStore.getState().setSupervision('session-1', supervision);

      const updated = { ...supervision, currentIteration: 5 };
      useSupervisionStore.getState().updateSupervision(updated);

      expect(useSupervisionStore.getState().supervisions['session-1'].currentIteration).toBe(5);
    });

    it('adds supervision for non-existent session (upsert behavior)', () => {
      const supervision = createSupervision({ sessionId: 'session-new' });
      useSupervisionStore.getState().updateSupervision(supervision);

      expect(useSupervisionStore.getState().supervisions['session-new']).toEqual(supervision);
    });

    it('does not affect other sessions when updating', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1', goal: 'Goal A' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2', goal: 'Goal B' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);

      const updated = { ...sup1, goal: 'Updated Goal A' };
      useSupervisionStore.getState().updateSupervision(updated);

      expect(useSupervisionStore.getState().supervisions['session-1'].goal).toBe('Updated Goal A');
      expect(useSupervisionStore.getState().supervisions['session-2'].goal).toBe('Goal B');
    });
  });

  describe('removeSupervision', () => {
    it('removes a supervision by sessionId', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);
      useSupervisionStore.getState().removeSupervision('session-1');

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
    });

    it('does nothing when removing non-existent session', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);
      useSupervisionStore.getState().removeSupervision('session-nonexistent');

      expect(useSupervisionStore.getState().supervisions['session-1']).toEqual(supervision);
    });

    it('does not affect other sessions', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);
      useSupervisionStore.getState().removeSupervision('session-1');

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
      expect(useSupervisionStore.getState().supervisions['session-2']).toEqual(sup2);
    });
  });

  describe('pendingPlanningHints', () => {
    beforeEach(() => {
      useSupervisionStore.setState({ pendingPlanningHints: {} });
    });

    it('sets a pending hint for a session', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Build auth');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('Build auth');
    });

    it('overwrites existing hint for same session', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Old hint');
      useSupervisionStore.getState().setPendingHint('session-1', 'New hint');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('New hint');
    });

    it('does not affect hints for other sessions', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Hint A');
      useSupervisionStore.getState().setPendingHint('session-2', 'Hint B');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('Hint A');
      expect(useSupervisionStore.getState().pendingPlanningHints['session-2']).toBe('Hint B');
    });

    it('clears a pending hint for a session', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'To be cleared');
      useSupervisionStore.getState().clearPendingHint('session-1');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBeUndefined();
    });

    it('clearing one session does not affect others', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Hint A');
      useSupervisionStore.getState().setPendingHint('session-2', 'Hint B');
      useSupervisionStore.getState().clearPendingHint('session-1');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBeUndefined();
      expect(useSupervisionStore.getState().pendingPlanningHints['session-2']).toBe('Hint B');
    });

    it('clearing non-existent session is a no-op', () => {
      useSupervisionStore.getState().setPendingHint('session-1', 'Keep me');
      useSupervisionStore.getState().clearPendingHint('session-nonexistent');

      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('Keep me');
    });

    it('does not affect supervisions state', () => {
      const supervision = createSupervision();
      useSupervisionStore.getState().setSupervision('session-1', supervision);
      useSupervisionStore.getState().setPendingHint('session-1', 'Some hint');

      expect(useSupervisionStore.getState().supervisions['session-1']).toEqual(supervision);
      expect(useSupervisionStore.getState().pendingPlanningHints['session-1']).toBe('Some hint');
    });
  });

  describe('multi-session scenarios', () => {
    it('handles multiple sessions simultaneously', () => {
      const sessions = Array.from({ length: 5 }, (_, i) =>
        createSupervision({ id: `sup-${i}`, sessionId: `session-${i}`, goal: `Goal ${i}` })
      );

      sessions.forEach((sup) => {
        useSupervisionStore.getState().setSupervision(sup.sessionId, sup);
      });

      expect(Object.keys(useSupervisionStore.getState().supervisions)).toHaveLength(5);

      sessions.forEach((sup) => {
        expect(useSupervisionStore.getState().supervisions[sup.sessionId]).toEqual(sup);
      });
    });

    it('handles interleaved set and remove operations', () => {
      const sup1 = createSupervision({ id: 'sup-1', sessionId: 'session-1' });
      const sup2 = createSupervision({ id: 'sup-2', sessionId: 'session-2' });
      const sup3 = createSupervision({ id: 'sup-3', sessionId: 'session-3' });

      useSupervisionStore.getState().setSupervision('session-1', sup1);
      useSupervisionStore.getState().setSupervision('session-2', sup2);
      useSupervisionStore.getState().removeSupervision('session-1');
      useSupervisionStore.getState().setSupervision('session-3', sup3);

      expect(useSupervisionStore.getState().supervisions['session-1']).toBeUndefined();
      expect(useSupervisionStore.getState().supervisions['session-2']).toEqual(sup2);
      expect(useSupervisionStore.getState().supervisions['session-3']).toEqual(sup3);
    });

    it('update on non-existent then remove behaves correctly', () => {
      const supervision = createSupervision({ sessionId: 'session-new' });

      useSupervisionStore.getState().updateSupervision(supervision);
      expect(useSupervisionStore.getState().supervisions['session-new']).toEqual(supervision);

      useSupervisionStore.getState().removeSupervision('session-new');
      expect(useSupervisionStore.getState().supervisions['session-new']).toBeUndefined();
    });
  });
});
