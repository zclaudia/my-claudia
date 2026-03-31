import { describe, it, expect, beforeEach } from 'vitest';
import { trackAndAutoComplete, finalizeSession, clearSession } from '../todo-state-tracker.js';

describe('todo-state-tracker', () => {
  const sessionId = 'test-session';

  beforeEach(() => {
    clearSession(sessionId);
  });

  describe('trackAndAutoComplete', () => {
    it('returns no updates on first call', () => {
      const updates = trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'Task A', status: 'pending' },
        { content: 'Task B', status: 'pending' },
      ]);
      expect(updates).toEqual([]);
    });

    it('marks disappeared items as completed', () => {
      trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'Task A', status: 'pending' },
        { content: 'Task B', status: 'pending' },
      ]);

      // Second call: Task A disappeared, Task C is new
      const updates = trackAndAutoComplete(sessionId, 'id-2', [
        { content: 'Task B', status: 'in_progress' },
        { content: 'Task C', status: 'pending' },
      ]);

      expect(updates).toHaveLength(1);
      expect(updates[0].interactionId).toBe('id-1');
      expect(updates[0].todos).toEqual([
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'pending' }, // still in new list, not touched
      ]);
    });

    it('does not re-complete already completed items', () => {
      trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'pending' },
      ]);

      const updates = trackAndAutoComplete(sessionId, 'id-2', [
        { content: 'Task C', status: 'pending' },
      ]);

      expect(updates).toHaveLength(1);
      expect(updates[0].todos).toEqual([
        { content: 'Task A', status: 'completed' }, // was already completed
        { content: 'Task B', status: 'completed' }, // disappeared → completed
      ]);
    });

    it('returns no updates when all items persist', () => {
      trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'Task A', status: 'pending' },
      ]);

      const updates = trackAndAutoComplete(sessionId, 'id-2', [
        { content: 'Task A', status: 'in_progress' },
        { content: 'Task B', status: 'pending' },
      ]);

      expect(updates).toEqual([]);
    });

    it('only updates the most recent previous interaction', () => {
      trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'Task A', status: 'pending' },
      ]);
      trackAndAutoComplete(sessionId, 'id-2', [
        { content: 'Task A', status: 'in_progress' },
        { content: 'Task B', status: 'pending' },
      ]);

      // Third call: both A and B disappear — only id-2 (most recent) is updated
      const updates = trackAndAutoComplete(sessionId, 'id-3', [
        { content: 'Task C', status: 'pending' },
      ]);

      expect(updates).toHaveLength(1);
      expect(updates[0].interactionId).toBe('id-2');
      expect(updates[0].todos).toEqual([
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'completed' },
      ]);
    });

    it('handles sliding window pattern correctly', () => {
      // Initial full list
      trackAndAutoComplete(sessionId, 'id-0', [
        { content: 'A', status: 'pending' },
        { content: 'B', status: 'pending' },
        { content: 'C', status: 'pending' },
        { content: 'D', status: 'pending' },
      ]);

      // Window 1: [A, B] — pure narrowing (no new items), skip auto-complete
      const u1 = trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'A', status: 'in_progress' },
        { content: 'B', status: 'pending' },
      ]);
      expect(u1).toEqual([]); // C,D are NOT prematurely completed

      // Window 2: [B, C] — C is new (not in id-1), window shifted → auto-complete A
      const u2 = trackAndAutoComplete(sessionId, 'id-2', [
        { content: 'B', status: 'in_progress' },
        { content: 'C', status: 'pending' },
      ]);
      expect(u2).toHaveLength(1);
      expect(u2[0].interactionId).toBe('id-1');
      expect(u2[0].todos).toEqual([
        { content: 'A', status: 'completed' },
        { content: 'B', status: 'pending' }, // still in new list
      ]);

      // Window 3: [C, D] — D is new, window shifted → auto-complete B
      const u3 = trackAndAutoComplete(sessionId, 'id-3', [
        { content: 'C', status: 'in_progress' },
        { content: 'D', status: 'pending' },
      ]);
      expect(u3).toHaveLength(1);
      expect(u3[0].interactionId).toBe('id-2');
      expect(u3[0].todos).toEqual([
        { content: 'B', status: 'completed' },
        { content: 'C', status: 'pending' }, // still in new list
      ]);

      // Window 4: [D] — pure narrowing (no new items), skip auto-complete
      const u4 = trackAndAutoComplete(sessionId, 'id-4', [
        { content: 'D', status: 'in_progress' },
      ]);
      expect(u4).toEqual([]); // C stays pending, finalize will handle it
    });

    it('skips auto-complete on pure narrowing but finalize catches it', () => {
      trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'C', status: 'in_progress' },
        { content: 'D', status: 'pending' },
      ]);

      // Narrow to just [D] — no new items, skip
      const u = trackAndAutoComplete(sessionId, 'id-2', [
        { content: 'D', status: 'in_progress' },
      ]);
      expect(u).toEqual([]);

      // Finalize marks all remaining as completed
      const fin = finalizeSession(sessionId);
      expect(fin).toHaveLength(2);
      expect(fin[0].interactionId).toBe('id-1');
      expect(fin[0].todos).toEqual([
        { content: 'C', status: 'completed' },
        { content: 'D', status: 'completed' },
      ]);
      expect(fin[1].interactionId).toBe('id-2');
      expect(fin[1].todos).toEqual([
        { content: 'D', status: 'completed' },
      ]);
    });
  });

  describe('finalizeSession', () => {
    it('marks all remaining items as completed', () => {
      trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'in_progress' },
      ]);
      // Second call keeps Task B, so id-1's Task B is NOT auto-completed
      trackAndAutoComplete(sessionId, 'id-2', [
        { content: 'Task B', status: 'in_progress' },
        { content: 'Task C', status: 'pending' },
      ]);

      const updates = finalizeSession(sessionId);

      expect(updates).toHaveLength(2);
      // id-1: Task B was in_progress → completed
      expect(updates[0].interactionId).toBe('id-1');
      expect(updates[0].todos).toEqual([
        { content: 'Task A', status: 'completed' },
        { content: 'Task B', status: 'completed' },
      ]);
      // id-2: Task B and Task C → completed
      expect(updates[1].interactionId).toBe('id-2');
      expect(updates[1].todos).toEqual([
        { content: 'Task B', status: 'completed' },
        { content: 'Task C', status: 'completed' },
      ]);
    });

    it('returns empty when all items already completed', () => {
      trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'Task A', status: 'completed' },
      ]);

      const updates = finalizeSession(sessionId);
      expect(updates).toEqual([]);
    });

    it('cleans up session state after finalize', () => {
      trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'Task A', status: 'pending' },
      ]);

      finalizeSession(sessionId);

      // Next call should behave like first call (no previous state)
      const updates = trackAndAutoComplete(sessionId, 'id-2', [
        { content: 'Task B', status: 'pending' },
      ]);
      expect(updates).toEqual([]);
    });

    it('returns empty for unknown session', () => {
      expect(finalizeSession('unknown-session')).toEqual([]);
    });
  });

  describe('clearSession', () => {
    it('removes session state without producing updates', () => {
      trackAndAutoComplete(sessionId, 'id-1', [
        { content: 'Task A', status: 'pending' },
      ]);

      clearSession(sessionId);

      // Next call should behave like first call
      const updates = trackAndAutoComplete(sessionId, 'id-2', [
        { content: 'Task B', status: 'pending' },
      ]);
      expect(updates).toEqual([]);
    });
  });
});
