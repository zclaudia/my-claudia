import type { ServerMessage } from '@my-claudia/shared';
import { useLocalIssueStore } from './store';
import { useLocalIssueCommentStore } from './comments-store';

export function handleLocalIssueMessage(msg: ServerMessage): boolean {
  switch (msg.type) {
    case 'local_issue_update': {
      const { projectId, issue } = msg as any;
      useLocalIssueStore.getState().upsertIssue(projectId, issue);
      return true;
    }

    case 'local_issue_deleted': {
      const { projectId, issueId } = msg as any;
      useLocalIssueStore.getState().removeIssue(projectId, issueId);
      useLocalIssueCommentStore.getState().clearIssue(issueId);
      return true;
    }

    case 'local_issue_comment_update': {
      const { comment } = msg as any;
      useLocalIssueCommentStore.getState().upsertComment(comment);
      return true;
    }

    case 'local_issue_comment_deleted': {
      const { issueId, commentId } = msg as any;
      useLocalIssueCommentStore.getState().deleteCommentLocal(issueId, commentId);
      return true;
    }

    default:
      return false;
  }
}
