export { registerSessionsDomain, type SessionsDomainDeps } from './register.js';
export { createSessionRoutes } from './routes.js';
export { createSessionDraftRoutes } from './drafts-routes.js';
export { mountMessageRoutes } from './message-routes.js';
export { mountSearchRoutes } from './search-routes.js';
export { SessionRepository } from './repository.js';
export { SessionDraftRepository } from './draft-repository.js';
export {
  SessionMessageRepository,
  type CreateSessionMessageInput,
  type SessionMessageListOptions,
  type StoredSessionMessage,
} from './message-repository.js';
export {
  SessionSearchRepository,
  type SessionSearchQuery,
  type SessionSearchResult,
} from './search-repository.js';
export { SessionLifecycleError, SessionLifecycleService } from './lifecycle-service.js';
export {
  SessionQueryError,
  SessionQueryService,
  type SessionSyncResult,
  type SyncedSessionSummary,
} from './query-service.js';
export {
  SessionExportError,
  SessionExportService,
  type SessionExportResult,
} from './export-service.js';
export type { SessionEventPublisherPort } from './session-event-port.js';
export {
  buildTaskPlanningSession,
  buildTaskExecutingSessionPatch,
  buildTaskPlannedSessionPatch,
  buildTaskUnlockedSessionPatch,
  normalizeSessionType,
  normalizeSessionCreateInput,
  buildSessionUpdatePatch,
  isSessionValidationError,
  type SessionCreateInput,
  type SessionUpdatePatch,
  type TaskSessionSeed,
} from './model.js';
