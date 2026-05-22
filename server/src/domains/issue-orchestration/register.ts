// server/src/domains/issue-orchestration/register.ts
import type { Database } from 'better-sqlite3';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { ExecutorRegistry } from '../executor/index.js';
import type { SpecChangeService } from '../openspec/spec-change-service.js';
import type { ArchiveService } from '../openspec/archive-service.js';
import { EventDispatcher } from '../supervision/event-dispatcher.js';
import { ExecutorService } from './executor-service.js';
import { IssueLifecycle } from './issue-lifecycle.js';
import { IssueStatusPropagator } from './status-propagator.js';
import { AnonymousIssueService } from './anonymous-issue-service.js';
import type { IssueDomainEvent } from './events.js';

export interface RegisterIssueOrchestrationDeps {
  db: Database;
  registry: ExecutorRegistry;
  specChangeService: SpecChangeService;
  archiveService: ArchiveService;
  /**
   * Optional: when provided, every IssueDomainEvent is translated to a typed
   * ServerMessage and broadcast to all clients of the originating project.
   * Wired in bootstrap to `broadcastToAuthenticatedClients(clients, msg)`.
   */
  broadcast?: (projectId: string, msg: ServerMessage) => void;
}

export interface IssueOrchestration {
  dispatcher: EventDispatcher<IssueDomainEvent>;
  executorService: ExecutorService;
  lifecycle: IssueLifecycle;
  propagator: IssueStatusPropagator;
  anonymousService: AnonymousIssueService;
  /** Stop propagator subscription and (if installed) broadcast subscription. */
  dispose: () => void;
}

export function registerIssueOrchestration(deps: RegisterIssueOrchestrationDeps): IssueOrchestration {
  const dispatcher = new EventDispatcher<IssueDomainEvent>();
  const executorService = new ExecutorService({ db: deps.db, registry: deps.registry, dispatcher });
  const lifecycle = new IssueLifecycle({
    db: deps.db,
    specChangeService: deps.specChangeService,
    dispatcher,
    archiveService: deps.archiveService,
  });
  const propagator = new IssueStatusPropagator({ db: deps.db, dispatcher, lifecycle });
  const disposePropagator = propagator.install();
  const anonymousService = new AnonymousIssueService(lifecycle);

  // G8: translate IssueDomainEvent → typed ServerMessage and push over WS.
  let disposeBroadcast: (() => void) | undefined;
  if (deps.broadcast) {
    const broadcast = deps.broadcast;
    const handler = (event: IssueDomainEvent): void => {
      const msg = translateEventToMessage(event);
      if (!msg) return;
      broadcast(msg.projectId, msg);
    };
    dispatcher.onAny(handler);
    disposeBroadcast = (): void => dispatcher.offAny(handler);
  }

  return {
    dispatcher,
    executorService,
    lifecycle,
    propagator,
    anonymousService,
    dispose: (): void => {
      disposePropagator();
      disposeBroadcast?.();
    },
  };
}

/**
 * Translate a domain event to its WS-pushable ServerMessage form. Returns null
 * when there is no analog (or the source event lacks the data we need).
 *
 * The returned message intersects ServerMessage with a guaranteed projectId
 * field — every openspec_* variant carries projectId, so callers can route by
 * project without an extra type narrow.
 */
function translateEventToMessage(
  event: IssueDomainEvent,
): (ServerMessage & { projectId: string }) | null {
  switch (event.type) {
    case 'executor.status_changed':
      return {
        type: 'openspec_executor_status_changed',
        projectId: event.projectId,
        executorInstanceId: event.executorInstanceId,
        specChangeId: event.specChangeId,
        prev: event.prev,
        next: event.next,
        at: event.at,
      };
    case 'sub_issue.status_changed':
      return {
        type: 'openspec_sub_issue_status_changed',
        projectId: event.projectId,
        subIssueId: event.subIssueId,
        prev: event.prev,
        next: event.next,
        at: event.at,
      };
    case 'spec_change.status_changed':
      // Intentionally unmapped. As of G3 this event variant is declared in
      // events.ts but no production code path actually emits it — there are
      // zero `dispatcher.dispatch({ type: 'spec_change.status_changed', ... })`
      // call sites in the server. It also lacks a projectId field on the
      // event payload, which we'd need for routing. Revisit when a real emit
      // site lands (and add projectId at that time).
      return null;
    default:
      return null;
  }
}
