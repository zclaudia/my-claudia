import { useClaudiaStore } from '../stores/claudiaStore';
import { usePermissionStore } from '../stores/permissionStore';

/**
 * Derives Claudia-level status flags from task + permission stores.
 * Used by App.tsx (to emit Tauri events) and ClaudiaChatWindow (to sync ring state).
 */
export function useClaudiaStatus() {
  const claudiaTaskSessionIds = useClaudiaStore((s) =>
    s.tasks
      .map((task) => task.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId))
  );

  const hasRunning = useClaudiaStore((s) =>
    s.tasks.some((t) => t.status === 'running' || t.status === 'queued' || t.status === 'waiting')
    || s.inlineResponses.some((r) => r.status === 'streaming')
  );

  const hasPermissionPending = usePermissionStore((state) =>
    state.pendingRequests.some((request) => !request.sessionId || claudiaTaskSessionIds.includes(request.sessionId))
  );

  const hasUnread = useClaudiaStore((s) => {
    const taskUnread = !s.isExpanded && s.tasks.some((task) => task.updatedAt > s.lastViewedAt);
    const inlineUnread = !s.isExpanded && s.inlineResponses.some((r) => r.updatedAt > s.lastViewedAt && r.status !== 'promoted');
    return taskUnread || inlineUnread;
  });

  return {
    claudiaTaskSessionIds,
    hasRunning,
    hasPermissionPending,
    hasUnread,
  };
}
