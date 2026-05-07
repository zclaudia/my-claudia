import type { Database } from 'better-sqlite3';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { LocalIssue } from '@my-claudia/shared/features/local-issue';
import type { LocalIssueUpdateMessage, LocalIssueDeletedMessage } from '@my-claudia/shared/protocol/messages/workflow';
import { LocalIssueRepository } from './repository.js';

export class LocalIssueService {
  private repo: LocalIssueRepository;

  constructor(
    db: Database,
    private broadcastToProject: (projectId: string, msg: ServerMessage) => void,
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
    this.broadcastToProject(issue.projectId, {
      type: 'local_issue_deleted',
      projectId: issue.projectId,
      issueId,
    } as LocalIssueDeletedMessage);
    return { projectId: issue.projectId };
  }

  private broadcastIssueUpdate(issue: LocalIssue): void {
    this.broadcastToProject(issue.projectId, {
      type: 'local_issue_update',
      projectId: issue.projectId,
      issue,
    } as LocalIssueUpdateMessage);
  }
}
