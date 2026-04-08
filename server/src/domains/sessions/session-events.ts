/**
 * Domain events for the session lifecycle.
 *
 * These events are dispatched after successful mutations in the lifecycle service
 * and can be observed by other domains or infrastructure layers.
 */

export interface SessionEventBase {
  sessionId: string;
  projectId?: string;
  timestamp: number;
}

export interface SessionCreated extends SessionEventBase {
  type: 'session.created';
}

export interface SessionArchived extends SessionEventBase {
  type: 'session.archived';
}

export interface SessionRestored extends SessionEventBase {
  type: 'session.restored';
}

export interface SessionMetadataUpdated extends SessionEventBase {
  type: 'session.metadata_updated';
  fields: string[];
}

export interface SessionDeleted extends SessionEventBase {
  type: 'session.deleted';
}

export interface SessionPlanStatusChanged extends SessionEventBase {
  type: 'session.plan_status_changed';
  from: string | null;
  to: string | null;
}

export interface SessionUnlocked extends SessionEventBase {
  type: 'session.unlocked';
}

export type SessionDomainEvent =
  | SessionCreated
  | SessionArchived
  | SessionRestored
  | SessionMetadataUpdated
  | SessionDeleted
  | SessionPlanStatusChanged
  | SessionUnlocked;
