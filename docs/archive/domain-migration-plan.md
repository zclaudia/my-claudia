# Domain Migration Plan

## Goal

Incrementally migrate feature-heavy areas from layer-first organization to domain-first organization without a big-bang rewrite.

This plan keeps shared infrastructure global and only moves domains that already have strong business boundaries.

## Target Scope

Migrate first:

- `local-pr`
- `workflows`
- `supervision`
- `scheduled-tasks`

Keep global:

- `shared/src/core`
- `shared/src/protocol`
- `server/src/utils`
- `server/src/storage/db.ts`
- `apps/desktop/src/components/ui`
- `apps/desktop/src/hooks/transport`
- cross-cutting bootstrapping files

## Target Structure

### Desktop

```text
apps/desktop/src/features/<domain>/
  api.ts
  store.ts
  handlers.ts
  components/
  index.ts
```

### Server

```text
server/src/domains/<domain>/
  routes.ts
  service.ts
  repository.ts
  types.ts
  index.ts
```

## Migration Rules

1. Migrate one domain at a time.
2. Prefer compatibility re-exports during transition.
3. Do not mix behavior changes with file moves.
4. After each phase, update imports to the new domain entrypoints.
5. Only remove compatibility layers after all internal imports have flipped.

## Phases

### Phase 1: `local-pr` desktop

Move into `apps/desktop/src/features/local-pr/`:

- API
- store
- feature components

Acceptance:

- existing desktop tests pass for local PR flows
- old import paths continue to work via compatibility exports
- new imports use `features/local-pr`

### Phase 2: `local-pr` server

Move into `server/src/domains/local-pr/`:

- route construction
- service
- repository entrypoint

Acceptance:

- route/service wiring still passes tests
- `server-setup.ts` depends on a domain entrypoint rather than multiple files

### Phase 3: shared app wiring

Reduce global switchboards:

- split desktop `messageHandler` by domain delegation
- split server bootstrapping into feature/domain registration helpers

Acceptance:

- global files become orchestration-only
- domain-specific message handling lives with the domain

### Phase 4: repeat for `workflows`, `supervision`, `scheduled-tasks`

Order:

1. `workflows`
2. `supervision`
3. `scheduled-tasks`

## Notes

- `gateway` does not currently need domain migration.
- `shared` is already close to the desired shape and should mostly stay as-is.
