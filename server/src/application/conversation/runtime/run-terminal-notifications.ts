import type { NotificationService } from '../../../domains/notification-feed/index.js';
import type { NotificationSender } from '../../../infrastructure/push/notification-sender.js';
import {
  buildAppSelectionClickUrl,
  formatSessionBackendContext,
  getBackendRouteId,
  getSessionDisplayName,
} from '../../../infrastructure/push/notification-context.js';

interface SqliteLikeDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prepare?: (sql: string) => { get: (...args: any[]) => Record<string, unknown> | undefined };
}

const RUN_NOTIFICATION_DEDUPE_WINDOW_MS = 60_000;

interface TerminalRunNotificationInput {
  db: SqliteLikeDb | null | undefined;
  sessionId: string;
  notificationSender: NotificationSender;
  notificationsService?: NotificationService;
}

function getSessionProjectId(db: SqliteLikeDb | null | undefined, sessionId: string): string | undefined {
  if (!db?.prepare) return undefined;
  try {
    const row = db.prepare(`
      SELECT project_id as projectId
      FROM sessions
      WHERE id = ?
    `).get(sessionId);
    return typeof row?.projectId === 'string' && row.projectId.trim() ? row.projectId : undefined;
  } catch {
    return undefined;
  }
}

function hasRecentRunNotification(
  db: SqliteLikeDb | null | undefined,
  sessionId: string,
  title: string,
  status: 'completed' | 'failed',
  now = Date.now(),
): boolean {
  if (!db?.prepare) return false;
  try {
    const row = db.prepare(`
      SELECT id
      FROM notifications
      WHERE session_id = ?
        AND title = ?
        AND status = ?
        AND created_at >= ?
      ORDER BY created_at DESC
      LIMIT 1
    `).get(sessionId, title, status, now - RUN_NOTIFICATION_DEDUPE_WINDOW_MS);
    return !!row?.id;
  } catch {
    return false;
  }
}

export function postRunCompletedNotification(input: TerminalRunNotificationInput): void {
  const { db, sessionId, notificationSender, notificationsService } = input;
  const sessionName = getSessionDisplayName(db, sessionId);
  const title = `Run completed: ${sessionName}`;

  if (notificationsService) {
    if (hasRecentRunNotification(db, sessionId, title, 'completed')) {
      return;
    }
    notificationsService.postItem({
      sessionId,
      projectId: getSessionProjectId(db, sessionId),
      ownerBackendId: getBackendRouteId(db) ?? 'local-standalone',
      source: 'manual',
      title,
      summary: 'Session response is ready.',
      status: 'completed',
      initiator: 'system',
    });
    return;
  }

  void notificationSender.notify({
    type: 'run_completed',
    title: 'Run completed',
    body: `${formatSessionBackendContext(db, sessionId)} completed.`,
    priority: 'default',
    tags: ['white_check_mark'],
    clickUrl: buildAppSelectionClickUrl(db, { sessionId }),
  });
}

export function postRunFailedNotification(
  input: TerminalRunNotificationInput & { error: string },
): void {
  const { db, error, sessionId, notificationSender, notificationsService } = input;
  const sessionName = getSessionDisplayName(db, sessionId);
  const title = `Run failed: ${sessionName}`;

  if (notificationsService) {
    if (hasRecentRunNotification(db, sessionId, title, 'failed')) {
      return;
    }
    notificationsService.postItem({
      sessionId,
      projectId: getSessionProjectId(db, sessionId),
      ownerBackendId: getBackendRouteId(db) ?? 'local-standalone',
      source: 'manual',
      title,
      error,
      status: 'failed',
      initiator: 'system',
    });
    return;
  }

  void notificationSender.notify({
    type: 'run_failed',
    title: 'Run failed',
    body: `${formatSessionBackendContext(db, sessionId)} failed: ${error.slice(0, 200)}`,
    priority: 'high',
    tags: ['x'],
    clickUrl: buildAppSelectionClickUrl(db, { sessionId }),
  });
}
