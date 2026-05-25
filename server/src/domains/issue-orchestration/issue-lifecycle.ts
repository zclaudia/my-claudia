// server/src/domains/issue-orchestration/issue-lifecycle.ts
import type { Database } from 'better-sqlite3';
import type {
  LocalIssue,
  LocalIssueStatus,
  LocalIssueType,
  LocalIssuePriority,
} from '@my-claudia/shared/features/local-issue';
import type { SpecChange } from '@my-claudia/shared/features/spec-change';
import { LocalIssueRepository } from '../local-issues/repository.js';
import { EpicRepository } from '../epics/repository.js';
import { SpecChangeService } from '../openspec/spec-change-service.js';
import type { ArchiveResult, ArchiveService } from '../openspec/archive-service.js';
import { EventDispatcher } from '../supervision/event-dispatcher.js';
import type { IssueDomainEvent } from './events.js';

export interface IssueLifecycleDeps {
  db: Database;
  specChangeService: SpecChangeService;
  dispatcher: EventDispatcher<IssueDomainEvent>;
  /** When provided, closeSubIssueAndArchive auto-invokes archive after close. */
  archiveService?: ArchiveService;
}

export interface CreateSubIssueInput {
  projectId: string;
  type: LocalIssueType;
  title: string;
  /** Optional Epic this issue rolls up into (C5). */
  epicId?: string;
  description?: string;
  priority?: LocalIssuePriority;
  labels?: string[];
  /** Override the auto-derived slug. Must be kebab-case, unique per project. */
  slug?: string;
  isAnonymous?: boolean;
}

/** Allowed sub-issue status transitions (C1 — collapsed 4-state machine). */
const SUB_ISSUE_TRANSITIONS: Record<LocalIssueStatus, LocalIssueStatus[]> = {
  open: ['tracked', 'closed', 'cancelled'],
  tracked: ['closed', 'cancelled'],
  closed: [],
  cancelled: [],
};

export class IssueLifecycle {
  private issueRepo: LocalIssueRepository;
  private epicRepo: EpicRepository;

  constructor(private deps: IssueLifecycleDeps) {
    this.issueRepo = new LocalIssueRepository(deps.db);
    this.epicRepo = new EpicRepository(deps.db);
  }

  createSubIssue(input: CreateSubIssueInput): { issue: LocalIssue; specChange: SpecChange } {
    // Validate Epic if provided
    if (input.epicId) {
      const epic = this.epicRepo.findById(input.epicId);
      if (!epic) throw new Error(`Epic not found: ${input.epicId}`);
      if (epic.projectId !== input.projectId) {
        throw new Error(`Epic belongs to a different project`);
      }
    }

    // Create the sub-issue first (so spec_change.subIssueId FK is valid).
    const issue = this.issueRepo.create({
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      priority: input.priority ?? 'medium',
      labels: input.labels ?? [],
      status: 'open',
      type: input.type,
      epicId: input.epicId,
      isAnonymous: input.isAnonymous ?? false,
    });

    // Derive slug if not supplied
    const slug = input.slug ?? (slugify(input.title) || issue.id.slice(0, 8));

    // Auto-create SpecChange + scaffold files
    const specChange = this.deps.specChangeService.createSpecChange({
      projectId: input.projectId,
      subIssueId: issue.id,
      slug,
      title: input.title,
    });

    // Back-link spec_change_id onto the issue
    const updatedIssue = this.issueRepo.update(issue.id, { specChangeId: specChange.id });

    return { issue: updatedIssue, specChange };
  }

  /** Apply a manual status transition (or no-op if already at target). Validates legality. */
  transitionStatus(issueId: string, next: LocalIssueStatus): LocalIssue {
    const current = this.issueRepo.findById(issueId);
    if (!current) throw new Error(`Issue not found: ${issueId}`);
    if (current.status === next) return current;
    const allowed = SUB_ISSUE_TRANSITIONS[current.status] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`Illegal status transition for ${current.type} issue: ${current.status} → ${next}`);
    }
    // C2 invariant: a sub-issue can only enter `tracked` if it has a
    // SpecChange backing it. Lifecycle progress beyond triage must always
    // be anchored to a Change for audit/traceability.
    if (next === 'tracked' && !current.specChangeId) {
      throw new Error(
        `Issue ${issueId} cannot transition to 'tracked' without a SpecChange. ` +
        `Upgrade it via the spec workflow first.`,
      );
    }
    const updated = this.issueRepo.update(issueId, {
      status: next,
      closedAt: (next === 'closed' || next === 'cancelled') ? Date.now() : undefined,
    });
    this.deps.dispatcher.dispatch({
      type: 'sub_issue.status_changed',
      subIssueId: issueId,
      projectId: current.projectId,
      prev: current.status,
      next,
      at: Date.now(),
    });
    return updated;
  }

  /** Convenience: close sub-issue + emit. Pure state-machine transition; no archive. */
  closeSubIssue(issueId: string): LocalIssue {
    return this.transitionStatus(issueId, 'closed');
  }

  /**
   * Close + (if archiveService configured) archive in one call.
   * Returns both the updated issue and the archive result.
   * Archive failure does NOT roll back the close — it surfaces in the result.
   */
  async closeSubIssueAndArchive(
    issueId: string,
  ): Promise<{ issue: LocalIssue; archive?: ArchiveResult }> {
    const issue = this.closeSubIssue(issueId);
    if (!this.deps.archiveService) return { issue };
    if (!issue.specChangeId) return { issue }; // no spec_change attached (defensive)
    const archive = await this.deps.archiveService.archive(issue.specChangeId);
    return { issue, archive };
  }

  cancelSubIssue(issueId: string): LocalIssue {
    return this.transitionStatus(issueId, 'cancelled');
  }

  getIssue(issueId: string): LocalIssue | null {
    return this.issueRepo.findById(issueId);
  }

  /** List LocalIssues grouped under an Epic. */
  listIssuesByEpic(epicId: string): LocalIssue[] {
    const rows = this.deps.db.prepare(
      `SELECT * FROM local_issues WHERE epic_id = ? ORDER BY created_at ASC`,
    ).all(epicId);
    return rows.map((r) => this.issueRepo.mapRow(r));
  }

  /** List all LocalIssues (anonymous included) for a project, newest first. */
  listByProject(projectId: string): LocalIssue[] {
    const rows = this.deps.db.prepare(
      `SELECT * FROM local_issues WHERE project_id = ? ORDER BY updated_at DESC, created_at DESC`,
    ).all(projectId);
    return rows.map((r) => this.issueRepo.mapRow(r));
  }
}

/** Convert a title to a kebab-case slug. Strips non-alphanumeric except hyphens. */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
