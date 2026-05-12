import type { Database } from 'better-sqlite3';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { LocalIssueComment } from '@my-claudia/shared/features/local-issue';
import type {
  LocalIssueCommentUpdateMessage,
  LocalIssueCommentDeletedMessage,
} from '@my-claudia/shared/protocol/messages/workflow';
import { LocalIssueCommentRepository } from './comment-repository.js';
import { LocalIssueRepository } from './repository.js';

/**
 * CRUD for comments attached to a LocalIssue. The repository's
 * `ON DELETE CASCADE` foreign key takes care of cleanup when the parent
 * issue is removed, but we expose `deleteByIssue` for explicit deletion
 * flows that need to broadcast `local_issue_comment_deleted` messages too.
 */
export class LocalIssueCommentService {
  private comments: LocalIssueCommentRepository;
  private issues: LocalIssueRepository;

  constructor(
    db: Database,
    private broadcastToProject: (projectId: string, msg: ServerMessage) => void,
  ) {
    this.comments = new LocalIssueCommentRepository(db);
    this.issues = new LocalIssueRepository(db);
  }

  getRepo(): LocalIssueCommentRepository {
    return this.comments;
  }

  listByIssue(issueId: string): LocalIssueComment[] {
    return this.comments.findByIssue(issueId);
  }

  createComment(issueId: string, body: string): LocalIssueComment {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Comment body is empty');
    const issue = this.issues.findById(issueId);
    if (!issue) throw new Error(`Issue ${issueId} not found`);
    const comment = this.comments.create(issueId, trimmed);
    this.broadcastUpdate(issue.projectId, comment);
    return comment;
  }

  updateComment(commentId: string, body: string): LocalIssueComment {
    const trimmed = body.trim();
    if (!trimmed) throw new Error('Comment body is empty');
    const updated = this.comments.updateBody(commentId, trimmed);
    const issue = this.issues.findById(updated.issueId);
    if (issue) this.broadcastUpdate(issue.projectId, updated);
    return updated;
  }

  deleteComment(commentId: string): { projectId: string; issueId: string } | null {
    const existing = this.comments.findById(commentId);
    if (!existing) return null;
    const issue = this.issues.findById(existing.issueId);
    this.comments.delete(commentId);
    if (issue) {
      this.broadcastToProject(issue.projectId, {
        type: 'local_issue_comment_deleted',
        projectId: issue.projectId,
        issueId: existing.issueId,
        commentId,
      } as LocalIssueCommentDeletedMessage);
      return { projectId: issue.projectId, issueId: existing.issueId };
    }
    return null;
  }

  private broadcastUpdate(projectId: string, comment: LocalIssueComment): void {
    this.broadcastToProject(projectId, {
      type: 'local_issue_comment_update',
      projectId,
      issueId: comment.issueId,
      comment,
    } as LocalIssueCommentUpdateMessage);
  }
}
