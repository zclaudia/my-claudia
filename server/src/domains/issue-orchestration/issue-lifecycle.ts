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

export interface CreateParentInput {
  projectId: string;
  title: string;
  description?: string;
  priority?: LocalIssuePriority;
  labels?: string[];
}

export interface CreateSubIssueInput {
  projectId: string;
  type: Exclude<LocalIssueType, 'feature'>;
  title: string;
  parentIssueId?: string;
  description?: string;
  priority?: LocalIssuePriority;
  labels?: string[];
  /** Override the auto-derived slug. Must be kebab-case, unique per project. */
  slug?: string;
  isAnonymous?: boolean;
}

/** Allowed sub-issue status transitions. Parent (feature) only does open ↔ closed/cancelled. */
const SUB_ISSUE_TRANSITIONS: Record<LocalIssueStatus, LocalIssueStatus[]> = {
  open: ['planning', 'cancelled'],
  planning: ['tasks_ready', 'cancelled'],
  tasks_ready: ['executing', 'cancelled'],
  executing: ['reviewing', 'cancelled'],
  reviewing: ['executing', 'closed', 'cancelled'],  // reviewing → executing allows revert if review surfaces issues
  closed: [],
  cancelled: [],
  in_progress: ['executing', 'closed', 'cancelled'],  // legacy fallback
};

const PARENT_TRANSITIONS: Record<LocalIssueStatus, LocalIssueStatus[]> = {
  open: ['closed', 'cancelled'],
  closed: ['open'],
  cancelled: [],
  // unused for parent:
  planning: [], tasks_ready: [], executing: [], reviewing: [], in_progress: [],
};

export class IssueLifecycle {
  private issueRepo: LocalIssueRepository;

  constructor(private deps: IssueLifecycleDeps) {
    this.issueRepo = new LocalIssueRepository(deps.db);
  }

  createParent(input: CreateParentInput): LocalIssue {
    return this.issueRepo.create({
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      priority: input.priority ?? 'medium',
      labels: input.labels ?? [],
      status: 'open',
      type: 'feature',
      isAnonymous: false,
    });
  }

  createSubIssue(input: CreateSubIssueInput): { issue: LocalIssue; specChange: SpecChange } {
    // Validate parent if provided
    if (input.parentIssueId) {
      const parent = this.issueRepo.findById(input.parentIssueId);
      if (!parent) throw new Error(`Parent issue not found: ${input.parentIssueId}`);
      if (parent.type !== 'feature') {
        throw new Error(`Parent issue must be of type 'feature', got '${parent.type}'`);
      }
      if (parent.projectId !== input.projectId) {
        throw new Error(`Parent issue belongs to a different project`);
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
      parentIssueId: input.parentIssueId,
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
    const table = current.type === 'feature' ? PARENT_TRANSITIONS : SUB_ISSUE_TRANSITIONS;
    const allowed = table[current.status] ?? [];
    if (!allowed.includes(next)) {
      throw new Error(`Illegal status transition for ${current.type} issue: ${current.status} → ${next}`);
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

  listSubIssues(parentIssueId: string): LocalIssue[] {
    const rows = this.deps.db.prepare(
      `SELECT * FROM local_issues WHERE parent_issue_id = ? ORDER BY created_at ASC`,
    ).all(parentIssueId);
    // mapRow is a public method on LocalIssueRepository (BaseRepository abstract).
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
