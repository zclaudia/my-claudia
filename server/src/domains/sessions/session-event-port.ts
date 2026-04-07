import type { Session } from '@my-claudia/shared/core/session';

export interface SessionEventPublisherPort {
  publishSessionEvent(type: 'created' | 'updated' | 'deleted', session: Session): void;
}
