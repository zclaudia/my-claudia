import type { Database } from 'better-sqlite3';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { LocalIssue } from '@my-claudia/shared/features/local-issue';
import type { LocalIssueUpdateMessage, LocalIssueDeletedMessage } from '@my-claudia/shared/protocol/messages/workflow';
import { LocalIssueRepository } from './repository.js';

export interface LocalIssueLifecycleHooks {
  /** Invoked synchronously when an issue is deleted. Used for cascade cleanup
   *  (e.g. removing all attachments owned by the issue). */
  onDelete?: (issueId: string, projectId: string) => void;
}

export class LocalIssueService {
  private repo: LocalIssueRepository;

  constructor(
    db: Database,
    private broadcastToProject: (projectId: string, msg: ServerMessage) => void,
    private hooks: LocalIssueLifecycleHooks = {},
  ) {
    this.repo = new LocalIssueRepository(db);
  }

  getRepo(): LocalIssueRepository {
    return this.repo;
  }

  createIssue(projectId: string, data: {
    title: string;
    description?: string;
    priority?: string;
    labels?: string[];
  }): LocalIssue {
    const issue = this.repo.create({
      projectId,
      title: data.title,
      description: data.description,
      status: 'open',
      priority: (data.priority as LocalIssue['priority']) ?? 'medium',
      labels: data.labels ?? [],
    });
    this.broadcastIssueUpdate(issue);
    return issue;
  }

  updateIssue(issueId: string, data: {
    title?: string;
    description?: string;
    priority?: string;
    labels?: string[];
    status?: string;
  }): LocalIssue {
    // C2 invariant: status changes go through IssueLifecycle for state-machine
    // validation; the simple update path here can only touch non-status fields.
    // Callers that need status changes must use the lifecycle endpoint.
    if (data.status !== undefined) {
      const existing = this.repo.findById(issueId);
      if (!existing) throw new Error(`Issue not found: ${issueId}`);
      // C5: feature was extracted to Epic; all LocalIssues now require a
      // SpecChange before entering `tracked`.
      if (data.status === 'tracked' && !existing.specChangeId) {
        throw new Error(
          `Issue ${issueId} cannot enter 'tracked' without a SpecChange. ` +
          `Upgrade it via the spec workflow first.`,
        );
      }
    }
    const issue = this.repo.update(issueId, {
      title: data.title,
      description: data.description,
      priority: data.priority as LocalIssue['priority'],
      labels: data.labels,
      status: data.status as LocalIssue['status'],
    });
    this.broadcastIssueUpdate(issue);
    return issue;
  }

  closeIssue(issueId: string): LocalIssue {
    const issue = this.repo.update(issueId, {
      status: 'closed',
      closedAt: Date.now(),
    });
    this.broadcastIssueUpdate(issue);
    return issue;
  }

  reopenIssue(issueId: string): LocalIssue {
    const issue = this.repo.update(issueId, {
      status: 'open',
      closedAt: undefined,
    });
    this.broadcastIssueUpdate(issue);
    return issue;
  }

  deleteIssue(issueId: string): { projectId: string } | null {
    const issue = this.repo.findById(issueId);
    if (!issue) return null;
    this.repo.delete(issueId);
    // Cascade BEFORE broadcasting so clients receive remove events from
    // dependent domains (attachments) ahead of the issue removal itself.
    try {
      this.hooks.onDelete?.(issueId, issue.projectId);
    } catch (err) {
      // Cleanup failures should not block the user-visible delete.
      console.error('[LocalIssueService] onDelete hook failed:', err);
    }
    this.broadcastToProject(issue.projectId, {
      type: 'local_issue_deleted',
      projectId: issue.projectId,
      issueId,
    } as LocalIssueDeletedMessage);
    return { projectId: issue.projectId };
  }

  issueExists(issueId: string): boolean {
    return this.repo.findById(issueId) !== null;
  }

  private broadcastIssueUpdate(issue: LocalIssue): void {
    this.broadcastToProject(issue.projectId, {
      type: 'local_issue_update',
      projectId: issue.projectId,
      issue,
    } as LocalIssueUpdateMessage);
  }
}
