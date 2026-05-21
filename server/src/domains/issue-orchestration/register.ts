// server/src/domains/issue-orchestration/register.ts
import type { Database } from 'better-sqlite3';
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
}

export interface IssueOrchestration {
  dispatcher: EventDispatcher<IssueDomainEvent>;
  executorService: ExecutorService;
  lifecycle: IssueLifecycle;
  propagator: IssueStatusPropagator;
  anonymousService: AnonymousIssueService;
  /** Stop propagator subscription. */
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
  const dispose = propagator.install();
  const anonymousService = new AnonymousIssueService(lifecycle);
  return { dispatcher, executorService, lifecycle, propagator, anonymousService, dispose };
}
