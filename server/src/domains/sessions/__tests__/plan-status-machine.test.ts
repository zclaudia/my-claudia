import { describe, expect, it } from 'vitest';
import {
  assertPlanStatusTransition,
  isSessionLocked,
  isSessionArchived,
} from '../plan-status-machine.js';

describe('plan-status-machine', () => {
  describe('assertPlanStatusTransition', () => {
    it('allows null -> null (no-op)', () => {
      expect(() => assertPlanStatusTransition(null, null)).not.toThrow();
    });

    it('allows null -> planning', () => {
      expect(() => assertPlanStatusTransition(null, 'planning')).not.toThrow();
    });

    it('allows planning -> planned', () => {
      expect(() => assertPlanStatusTransition('planning', 'planned')).not.toThrow();
    });

    it('allows planning -> executing', () => {
      expect(() => assertPlanStatusTransition('planning', 'executing')).not.toThrow();
    });

    it('allows planning -> null (unlock from planning)', () => {
      expect(() => assertPlanStatusTransition('planning', null)).not.toThrow();
    });

    it('allows planned -> executing', () => {
      expect(() => assertPlanStatusTransition('planned', 'executing')).not.toThrow();
    });

    it('allows planned -> null (unlock from planned)', () => {
      expect(() => assertPlanStatusTransition('planned', null)).not.toThrow();
    });

    it('allows executing -> null', () => {
      expect(() => assertPlanStatusTransition('executing', null)).not.toThrow();
    });

    it('treats undefined the same as null', () => {
      expect(() => assertPlanStatusTransition(undefined, 'planning')).not.toThrow();
      expect(() => assertPlanStatusTransition(undefined, undefined)).not.toThrow();
    });

    it('rejects null -> planned (must go through planning)', () => {
      expect(() => assertPlanStatusTransition(null, 'planned')).toThrow(
        "Invalid plan-status transition: 'null' -> 'planned'",
      );
    });

    it('rejects null -> executing (must go through planning)', () => {
      expect(() => assertPlanStatusTransition(null, 'executing')).toThrow(
        "Invalid plan-status transition: 'null' -> 'executing'",
      );
    });

    it('rejects executing -> planning (cannot go backwards)', () => {
      expect(() => assertPlanStatusTransition('executing', 'planning')).toThrow(
        "Invalid plan-status transition: 'executing' -> 'planning'",
      );
    });

    it('rejects planned -> planning (cannot go backwards)', () => {
      expect(() => assertPlanStatusTransition('planned', 'planning')).toThrow(
        "Invalid plan-status transition: 'planned' -> 'planning'",
      );
    });

    it('rejects executing -> planned (cannot go backwards)', () => {
      expect(() => assertPlanStatusTransition('executing', 'planned')).toThrow(
        "Invalid plan-status transition: 'executing' -> 'planned'",
      );
    });

    it('allows unknown status -> null (unlock fallback)', () => {
      expect(() => assertPlanStatusTransition('completed' as any, null)).not.toThrow();
      expect(() => assertPlanStatusTransition('ready' as any, null)).not.toThrow();
    });

    it('allows unknown status -> planning (unlock fallback)', () => {
      expect(() => assertPlanStatusTransition('completed' as any, 'planning')).not.toThrow();
      expect(() => assertPlanStatusTransition('ready' as any, 'planning')).not.toThrow();
    });

    it('rejects unknown status -> executing (not an unlock target)', () => {
      expect(() => assertPlanStatusTransition('completed' as any, 'executing')).toThrow(
        "Invalid plan-status transition: 'completed' -> 'executing'",
      );
    });
  });

  describe('isSessionLocked', () => {
    it('returns true when planStatus is planning', () => {
      expect(isSessionLocked({ planStatus: 'planning' })).toBe(true);
    });

    it('returns false when planStatus is planned', () => {
      expect(isSessionLocked({ planStatus: 'planned' })).toBe(false);
    });

    it('returns false when planStatus is executing', () => {
      expect(isSessionLocked({ planStatus: 'executing' })).toBe(false);
    });

    it('returns false when planStatus is null', () => {
      expect(isSessionLocked({ planStatus: null })).toBe(false);
    });

    it('returns false when planStatus is undefined', () => {
      expect(isSessionLocked({ planStatus: undefined })).toBe(false);
    });
  });

  describe('isSessionArchived', () => {
    it('returns true when archivedAt is set', () => {
      expect(isSessionArchived({ archivedAt: Date.now() })).toBe(true);
    });

    it('returns false when archivedAt is undefined', () => {
      expect(isSessionArchived({ archivedAt: undefined })).toBe(false);
    });

    it('returns false when archivedAt is null-ish (0 is falsy but still a number)', () => {
      // 0 is a valid timestamp (epoch), so it should be considered archived
      expect(isSessionArchived({ archivedAt: 0 })).toBe(true);
    });
  });
});
