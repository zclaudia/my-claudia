import type { ServerMessage } from '@my-claudia/shared';
import { useLocalIssueStore } from './store';

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
      return true;
    }

    default:
      return false;
  }
}
