import { describe, expect, it, vi } from 'vitest';

import {
  postRunCompletedNotification,
  postRunFailedNotification,
} from '../run-terminal-notifications.js';

function createDbRowMap(rows: Record<string, Record<string, unknown> | undefined>) {
  return {
    prepare: vi.fn((sql: string) => ({
      get: vi.fn((...args: unknown[]) => {
        const sessionId = args[0] as string;
        if (sql.includes('SELECT name')) return rows.name?.[sessionId];
        if (sql.includes('SELECT project_id')) return rows.project?.[sessionId];
        if (sql.includes('FROM notifications')) return rows.notifications?.[sessionId];
        return undefined;
      }),
    })),
  };
}

describe('run-terminal-notifications', () => {
  it('posts completed runs into notification feed when available', () => {
    const postItem = vi.fn();
    const db = createDbRowMap({
      name: { 'session-1': { name: 'Build API' } },
      project: { 'session-1': { projectId: 'project-1' } },
    });

    postRunCompletedNotification({
      db: db as any,
      sessionId: 'session-1',
      notificationSender: { notify: vi.fn() },
      notificationsService: { postItem } as any,
    });

    expect(postItem).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      projectId: 'project-1',
      title: 'Run completed: Build API',
      summary: 'Session response is ready.',
      status: 'completed',
    }));
  });

  it('falls back to push sender when feed service is unavailable', () => {
    const notify = vi.fn();
    const db = createDbRowMap({
      name: { 'session-1': { name: 'Build API' } },
      project: {},
    });

    postRunFailedNotification({
      db: db as any,
      sessionId: 'session-1',
      error: 'provider exploded',
      notificationSender: { notify },
    });

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      type: 'run_failed',
      title: 'Run failed',
      body: expect.stringContaining('provider exploded'),
    }));
  });

  it('skips duplicate completed feed notifications within the dedupe window', () => {
    const postItem = vi.fn();
    const db = createDbRowMap({
      name: { 'session-1': { name: 'Build API' } },
      project: { 'session-1': { projectId: 'project-1' } },
      notifications: { 'session-1': { id: 'existing-1' } },
    });

    postRunCompletedNotification({
      db: db as any,
      sessionId: 'session-1',
      notificationSender: { notify: vi.fn() },
      notificationsService: { postItem } as any,
    });

    expect(postItem).not.toHaveBeenCalled();
  });
});
