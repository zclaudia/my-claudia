// server/src/domains/issue-orchestration/status-propagator.ts
import type { Database } from 'better-sqlite3';
import type { ExecutorInstance, ExecutorStatus } from '@my-claudia/shared/features/executor';
import type { LocalIssueStatus } from '@my-claudia/shared/features/local-issue';
import { ExecutorInstanceRepository } from '../executor/index.js';
import { SpecChangeRepository } from '../spec-change/spec-change-repository.js';
import { LocalIssueRepository } from '../local-issues/repository.js';
import type { EventDispatcher, EventHandler } from '../supervision/event-dispatcher.js';
import type { IssueLifecycle } from './issue-lifecycle.js';
import type { ExecutorStatusChangedEvent, IssueDomainEvent } from './events.js';

export interface IssueStatusPropagatorDeps {
  db: Database;
  dispatcher: EventDispatcher<IssueDomainEvent>;
  lifecycle: IssueLifecycle;
}

/**
 * Subscribes to {@link ExecutorStatusChangedEvent}s and recomputes the
 * owning sub-issue's status from the aggregate of all executors attached
 * to the same `spec_change`. The derived status is then applied via
 * {@link IssueLifecycle.transitionStatus}, which itself emits a
 * `sub_issue.status_changed` event downstream.
 */
export class IssueStatusPropagator {
  private execRepo: ExecutorInstanceRepository;
  private specRepo: SpecChangeRepository;
  private issueRepo: LocalIssueRepository;

  constructor(private deps: IssueStatusPropagatorDeps) {
    this.execRepo = new ExecutorInstanceRepository(deps.db);
    this.specRepo = new SpecChangeRepository(deps.db);
    this.issueRepo = new LocalIssueRepository(deps.db);
  }

  /** Wire up the subscriber. Returns an unsubscribe function. */
  install(): () => void {
    const handler: EventHandler<IssueDomainEvent> = (event) => {
      if (event.type !== 'executor.status_changed') return;
      try {
        this.onExecutorStatusChanged(event);
      } catch (err) {
        console.error('[IssueStatusPropagator] error:', err);
      }
    };
    this.deps.dispatcher.on('executor.status_changed', handler);
    return () => this.deps.dispatcher.off('executor.status_changed', handler);
  }

  /** Resolve sub-issue, aggregate executors, derive + apply target status. */
  onExecutorStatusChanged(event: ExecutorStatusChangedEvent): void {
    const spec = this.specRepo.findById(event.specChangeId);
    if (!spec) return;
    const issue = this.issueRepo.findById(spec.subIssueId);
    if (!issue) return;

    const executors = this.execRepo.listBySpecChange(spec.id);
    const derived = deriveSubIssueStatus(executors, issue.status);
    if (!derived || derived === issue.status) return;
    try {
      this.deps.lifecycle.transitionStatus(issue.id, derived);
    } catch {
      // Illegal transition (e.g. already closed) — silently drop. Race conditions are fine.
    }
  }
}

/**
 * Pure helper exposed for testing.
 *
 * Maps the aggregate executor state to a sub-issue lifecycle status. Under
 * the collapsed 4-state model (C1), all non-terminal "active" work maps to
 * `tracked`; the rich progress signals live on the SpecChange and the
 * executor instances themselves.
 */
export function deriveSubIssueStatus(
  executors: ExecutorInstance[],
  _currentSubIssueStatus: LocalIssueStatus,
): LocalIssueStatus | null {
  if (executors.length === 0) return null;

  const states = executors.map((e) => e.statusSummary);
  const all = (s: ExecutorStatus): boolean => states.every((x) => x === s);

  // Strict terminal-only cases first.
  if (all('cancelled')) return 'cancelled';

  // All pending — no transition (sub-issue stays `open` until work starts).
  if (all('pending')) return null;

  // Any other mix (active, mixed terminal, mixed pending+touched, all-terminal
  // but not all-cancelled) → `tracked`. We do not auto-close on completion;
  // a human reviewer transitions `tracked → closed` explicitly.
  return 'tracked';
}
