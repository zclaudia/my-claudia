# Project Backend Ownership

This note defines the ownership rules for project data in multi-backend mode.

## Invariants

- `projectId` is owned by exactly one backend in the desktop client.
- `project_upsert` and `project_remove` must always be applied with the event's `backendId`, never the current active backend in the UI.
- Full project snapshots replace only the target backend's subset.
- A backend must not delete or mutate a project currently owned by another backend.

## Collision Policy

Backend project IDs are expected to be globally unique in practice. They are UUID-based today, so collisions should be extremely rare.

If two backends still present the same `projectId`, the client treats that as a protocol/data-integrity violation:

- snapshot merge: reject the colliding incoming project and keep the existing owner
- incremental event: reject the colliding upsert and keep the existing owner
- remove event: ignore the removal unless the sender matches the stored owner

The current fallback is intentionally conservative. It prefers preserving an already-owned project over allowing silent cross-backend overwrite.

## Current Implementation

- Desktop ownership map: `apps/desktop/src/stores/ownershipStore.ts`
- Project merge rules: `apps/desktop/src/stores/projectStore.ts`
- Backend facade event handling: `apps/desktop/src/hooks/useBackendFacade.ts`
- Server project change publication: `server/src/server-setup.ts`
- Gateway project/event transport: `server/src/domains/gateway/gateway-client.ts`

## Why This Exists

Without backend-scoped ownership, a remote project event can:

- overwrite another backend's project with the same id
- delete another backend's project
- route subsequent REST calls to the wrong backend

That failure mode is worse than temporarily dropping a malformed incoming project event, so the client now fails closed.
