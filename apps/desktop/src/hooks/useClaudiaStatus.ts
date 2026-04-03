import { useMemo } from 'react';
import { useClaudiaStore } from '../stores/claudiaStore';
import { usePermissionStore } from '../stores/permissionStore';

/**
 * Derives Claudia-level status flags from task + permission stores.
 * Used by App.tsx (to emit Tauri events) and ClaudiaChatWindow (to sync ring state).
 */
export function useClaudiaStatus() {
  const tasks = useClaudiaStore((s) => s.tasks);
  const inlineResponses = useClaudiaStore((s) => s.inlineResponses);
  const isExpanded = useClaudiaStore((s) => s.isExpanded);
  const lastViewedAt = useClaudiaStore((s) => s.lastViewedAt);
  const pendingRequests = usePermissionStore((s) => s.pendingRequests);

  const claudiaTaskSessionIds = useMemo(
    () => tasks
      .map((task) => task.sessionId)
      .filter((sessionId): sessionId is string => Boolean(sessionId)),
    [tasks],
  );

  const hasRunning = useMemo(
    () => tasks.some((t) => t.status === 'running' || t.status === 'queued' || t.status === 'waiting')
      || inlineResponses.some((r) => r.status === 'streaming'),
    [tasks, inlineResponses],
  );

  const hasPermissionPending = useMemo(
    () => pendingRequests.some((request) => !request.sessionId || claudiaTaskSessionIds.includes(request.sessionId)),
    [pendingRequests, claudiaTaskSessionIds],
  );

  const hasUnread = useMemo(() => {
    const taskUnread = !isExpanded && tasks.some((task) => task.updatedAt > lastViewedAt);
    const inlineUnread = !isExpanded && inlineResponses.some((r) => r.updatedAt > lastViewedAt && r.status !== 'promoted');
    return taskUnread || inlineUnread;
  }, [isExpanded, tasks, inlineResponses, lastViewedAt]);

  return {
    claudiaTaskSessionIds,
    hasRunning,
    hasPermissionPending,
    hasUnread,
  };
}
