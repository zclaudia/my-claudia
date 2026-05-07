import type { Request } from 'express';
import type { AttachmentOwnerKind } from '@my-claudia/shared/features/attachment';

/**
 * Owner access guard — looks up whether the requester may attach to / read
 * attachments of a given owner. Designed as an extensible point: today we
 * just verify that the owner kind is recognized; per-kind ACL hooks can be
 * registered later.
 *
 * Returning false sends 403 to the client.
 */
export type OwnerGuard = (ownerId: string, req: Request) => boolean | Promise<boolean>;

const guards = new Map<AttachmentOwnerKind, OwnerGuard>();

/**
 * Register a per-owner-kind access guard. If no guard is registered, access
 * is allowed by default (consistent with the rest of the same-server APIs
 * which already sit behind authMiddleware).
 */
export function registerOwnerGuard(kind: AttachmentOwnerKind, guard: OwnerGuard): void {
  guards.set(kind, guard);
}

export async function checkOwnerAccess(
  kind: AttachmentOwnerKind,
  ownerId: string,
  req: Request,
): Promise<boolean> {
  const guard = guards.get(kind);
  if (!guard) return true;
  try {
    return await guard(ownerId, req);
  } catch (err) {
    console.error(`[Attachments] Owner guard for ${kind} threw:`, err);
    return false;
  }
}

/**
 * Test helper — clears registered guards. Not exported from index.ts.
 */
export function __resetOwnerGuards(): void {
  guards.clear();
}
