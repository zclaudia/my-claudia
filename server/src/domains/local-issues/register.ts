import type { Express, RequestHandler } from 'express';
import type { ServerMessage } from '@my-claudia/shared/protocol/messages';
import type { initDatabase } from '../../infrastructure/storage/db.js';
import { LocalIssueService, type LocalIssueLifecycleHooks } from './service.js';
import { LocalIssueCommentService } from './comment-service.js';
import { createLocalIssueRoutes } from './routes.js';
import { registerOwnerGuard } from '../attachments/access-control.js';

export interface LocalIssueDomainDeps {
  db: ReturnType<typeof initDatabase>;
  app: Express;
  authMiddleware: RequestHandler;
  broadcast: (projectId: string, msg: ServerMessage) => void;
  /** Optional hooks consumed by other domains (e.g. attachments cascade delete). */
  hooks?: LocalIssueLifecycleHooks;
}

export interface LocalIssueDomainResult {
  localIssueService: LocalIssueService;
  localIssueCommentService: LocalIssueCommentService;
}

export function registerLocalIssueDomain(deps: LocalIssueDomainDeps): LocalIssueDomainResult {
  const { db, app, authMiddleware, broadcast, hooks } = deps;

  const localIssueCommentService = new LocalIssueCommentService(db, broadcast);
  // Cascade: when an issue is deleted we already get FK ON DELETE CASCADE in
  // SQL, but caller-supplied hooks (e.g. attachments) need to run first AND
  // we want the comment removals broadcast to clients explicitly. The DB
  // cascade still fires; broadcasting here just keeps the client store tidy.
  const cascadeHooks: LocalIssueLifecycleHooks = {
    ...(hooks ?? {}),
    onDelete: (issueId, projectId) => {
      try {
        // Snapshot before deletion so we can emit per-comment removals.
        const existing = localIssueCommentService.listByIssue(issueId);
        for (const c of existing) {
          broadcast(projectId, {
            type: 'local_issue_comment_deleted',
            projectId,
            issueId,
            commentId: c.id,
          });
        }
      } catch (err) {
        console.error('[LocalIssueDomain] comment cascade broadcast failed:', err);
      }
      hooks?.onDelete?.(issueId, projectId);
    },
  };

  const localIssueService = new LocalIssueService(db, broadcast, cascadeHooks);

  // Owner-existence guard for the attachments domain — refuses to attach
  // anything to an issue that has been deleted (or never existed).
  registerOwnerGuard('local_issue', (ownerId) => localIssueService.issueExists(ownerId));

  app.use('/api', authMiddleware, createLocalIssueRoutes(localIssueService, localIssueCommentService));

  return { localIssueService, localIssueCommentService };
}
