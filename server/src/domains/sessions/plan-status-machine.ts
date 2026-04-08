import type { Session } from '@my-claudia/shared/core/session';

/**
 * Plan-status state machine for task sessions.
 *
 * Valid statuses: null | 'planning' | 'planned' | 'executing'
 *
 * Transition graph:
 *   null       -> 'planning'   (task session opened for planning)
 *   'planning' -> 'planned'    (plan submitted / approved)
 *   'planning' -> 'executing'  (direct execution without separate approval step)
 *   'planned'  -> 'executing'  (approved plan starts executing)
 *   'executing'-> null         (execution complete, session unlocked)
 *   'planned'  -> null         (session unlocked from planned state)
 *   'planning' -> null         (session unlocked from planning state)
 *   null       -> null         (no-op, always valid)
 */

type PlanStatus = string | null | undefined;

/** Canonical key for the transition map (undefined treated as null). */
function normalizeStatus(status: PlanStatus): string {
  return status == null ? 'null' : status;
}

/**
 * Map from current status -> set of valid next statuses.
 */
const PLAN_STATUS_TRANSITIONS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['null',      new Set(['null', 'planning'])],
  ['planning',  new Set(['planned', 'executing', 'null'])],
  ['planned',   new Set(['executing', 'null'])],
  ['executing', new Set(['null'])],
]);

/**
 * Fallback transitions for statuses not explicitly in the map (e.g. legacy
 * or externally-managed statuses like 'ready', 'completed').
 * These can only transition to 'null' or 'planning' (the unlock targets).
 */
const UNKNOWN_STATUS_ALLOWED: ReadonlySet<string> = new Set(['null', 'planning']);

/**
 * Assert that a plan-status transition is valid.
 * Throws an Error if the transition is not allowed.
 *
 * For statuses not in the explicit transition map, a conservative fallback
 * allows transitioning to 'null' or 'planning' only (unlock paths).
 */
export function assertPlanStatusTransition(from: PlanStatus, to: PlanStatus): void {
  const fromKey = normalizeStatus(from);
  const toKey = normalizeStatus(to);

  const allowed = PLAN_STATUS_TRANSITIONS.get(fromKey) ?? UNKNOWN_STATUS_ALLOWED;
  if (!allowed.has(toKey)) {
    throw new Error(
      `Invalid plan-status transition: '${fromKey}' -> '${toKey}'`,
    );
  }
}

/**
 * Returns true if the session is currently locked for planning.
 * A session in 'planning' status is actively being planned and should not
 * have its worktree or working directory mutated externally.
 */
export function isSessionLocked(session: Pick<Session, 'planStatus'>): boolean {
  return session.planStatus === 'planning';
}

/**
 * Returns true if the session has been archived.
 */
export function isSessionArchived(session: Pick<Session, 'archivedAt'>): boolean {
  return session.archivedAt != null;
}

export { PLAN_STATUS_TRANSITIONS };
