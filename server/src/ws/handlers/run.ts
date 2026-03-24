import type {
  ErrorMessage,
  StopBackgroundTaskMessage,
  TaskNotificationMessage,
} from '@my-claudia/shared';
import type { ConnectedClient, ActiveRun } from '../types.js';
import type { ProcessMonitor } from '../../utils/process-monitor.js';
import type { initDatabase } from '../../storage/db.js';
import { isProcessAlive, killProcessTree } from '../../utils/process-tree.js';
import { providerRegistry } from '../../providers/registry.js';
import { sendMessage } from '../broadcast.js';

export async function handleKillLeakedProcesses(
  client: ConnectedClient,
  processMonitor: ProcessMonitor,
): Promise<void> {
  console.log('[ProcessMonitor] Manual kill triggered by client');
  const result = await processMonitor.cleanupNow();
  sendMessage(client.ws, {
    type: 'process_cleanup_result',
    status: result.status,
    leakedCount: result.leakedCount,
    killedCount: result.killedCount,
    activeRunCount: result.activeRunCount,
  });
}

export async function handleStopBackgroundTask(
  client: ConnectedClient,
  message: StopBackgroundTaskMessage,
  db: ReturnType<typeof initDatabase>,
  activeRuns: Map<string, ActiveRun>,
  findProcessPidsByTaskCommand: (taskCommand?: string, excludedPids?: number[]) => Promise<number[]>,
): Promise<void> {
  const { sessionId: targetSessionId, taskId, taskRootPid, cliPid, taskCommand } = message;

  // Strategy 1: Direct PID kill
  const directPid = taskRootPid;
  if (directPid && isProcessAlive(directPid)) {
    console.log(`[StopTask] Direct PID stop for task ${taskId}: pid=${directPid}`);
    killProcessTree(directPid)
      .then(({ killed, failed }) => {
        const stopped = killed.length > 0 && failed.length === 0 && !isProcessAlive(directPid);
        sendMessage(client.ws, {
          type: 'task_notification',
          runId: '',
          sessionId: targetSessionId,
          taskId,
          status: stopped ? 'stopped' : 'failed',
          message: stopped
            ? `Task stopped by PID ${directPid}`
            : `Failed to stop PID ${directPid}`,
          cliPid,
          taskRootPid,
        } as TaskNotificationMessage);
      })
      .catch(err => {
        console.error(`[StopTask] Direct PID stop failed for task ${taskId}:`, err);
        sendMessage(client.ws, {
          type: 'task_notification',
          runId: '',
          sessionId: targetSessionId,
          taskId,
          status: 'failed',
          message: `PID stop failed: ${err instanceof Error ? err.message : String(err)}`,
          cliPid,
          taskRootPid,
        } as TaskNotificationMessage);
      });
    return;
  }

  // Strategy 2: Command-matched kill
  const matchedPids = await findProcessPidsByTaskCommand(taskCommand, [cliPid, taskRootPid].filter((pid): pid is number => typeof pid === 'number'));
  if (matchedPids.length > 0) {
    console.log(`[StopTask] Command-matched stop for task ${taskId}: pids=[${matchedPids.join(',')}]`);
    const killResults = await Promise.all(matchedPids.map(pid => killProcessTree(pid)));
    const failed = killResults.flatMap(result => result.failed);
    const killed = killResults.flatMap(result => result.killed);
    sendMessage(client.ws, {
      type: 'task_notification',
      runId: '',
      sessionId: targetSessionId,
      taskId,
      status: killed.length > 0 && failed.length === 0 ? 'stopped' : 'failed',
      message: killed.length > 0 && failed.length === 0
        ? `Task stopped by command match (${matchedPids.join(', ')})`
        : `Failed to stop command-matched PID(s): ${matchedPids.join(', ')}`,
      cliPid,
      taskRootPid,
    } as TaskNotificationMessage);
    return;
  }

  // Strategy 3: Provider adapter kill
  const targetRun = [...activeRuns.values()].find(r => r.sessionId === targetSessionId);
  let resolvedProviderType = targetRun?.providerType;
  let resolvedSdkSessionId = targetRun?.providerSessionId;

  if (!resolvedSdkSessionId) {
    const sessionRow = db.prepare('SELECT sdk_session_id FROM sessions WHERE id = ?')
      .get(targetSessionId) as { sdk_session_id: string | null } | undefined;
    resolvedSdkSessionId = sessionRow?.sdk_session_id || undefined;
  }

  if (!resolvedProviderType) {
    const providerRow = db.prepare(`
      SELECT pr.type FROM sessions s
      LEFT JOIN projects p ON s.project_id = p.id
      LEFT JOIN providers pr ON pr.id = COALESCE(s.provider_id, p.provider_id)
      WHERE s.id = ? AND pr.type IS NOT NULL
    `).get(targetSessionId) as { type: string } | undefined;
    resolvedProviderType = providerRow?.type;
  }

  if (resolvedProviderType && resolvedSdkSessionId) {
    const adapter = providerRegistry.get(resolvedProviderType);
    if (adapter?.stopTask) {
      console.log(`[StopTask] Stopping task ${taskId}: adapter=${resolvedProviderType} sdkSession=${resolvedSdkSessionId}`);
      adapter.stopTask(resolvedSdkSessionId, taskId)
        .then((killed) => {
          sendMessage(client.ws, {
            type: 'task_notification',
            runId: targetRun?.runId || '',
            sessionId: targetSessionId,
            taskId,
            status: killed !== false ? 'stopped' : 'failed',
            message: killed !== false ? 'Task stopped by user' : 'No processes found to kill',
          } as TaskNotificationMessage);
        })
        .catch(err => {
          console.error(`[StopTask] Failed to stop task ${taskId}:`, err);
          sendMessage(client.ws, {
            type: 'task_notification',
            runId: targetRun?.runId || '',
            sessionId: targetSessionId,
            taskId,
            status: 'failed',
            message: `Stop failed: ${err instanceof Error ? err.message : String(err)}`,
          } as TaskNotificationMessage);
        });
      return;
    }
  }

  console.warn(`[StopTask] Cannot stop task ${taskId} in session ${targetSessionId} — providerType=${resolvedProviderType} sdkSessionId=${resolvedSdkSessionId}`);
}

export async function handleAgentCancel(
  client: ConnectedClient,
  sessionId: string,
  activeRuns: Map<string, ActiveRun>,
  cancelRun: (runId: string) => void,
  db: ReturnType<typeof initDatabase>,
  orchestrator?: { killTask: (taskId: string) => Promise<void>; },
): Promise<void> {
  let cancelled = false;

  for (const [runId, run] of activeRuns.entries()) {
    if (run.sessionId === sessionId && !run.completed) {
      cancelRun(runId);
      cancelled = true;
      break;
    }
  }

  if (!cancelled && orchestrator) {
    const taskRow = db.prepare(
      `SELECT id
       FROM orchestrator_tasks
       WHERE session_id = ? AND initiator = ?
       ORDER BY created_at DESC
       LIMIT 1`
    ).get(sessionId, 'claudia') as { id: string } | undefined;

    if (taskRow) {
      try {
        await orchestrator.killTask(taskRow.id);
      } catch (err) {
        sendMessage(client.ws, {
          type: 'error',
          code: 'TASK_CANCEL_FAILED',
          message: err instanceof Error ? err.message : 'Failed to cancel task',
        } as ErrorMessage);
      }
    }
  }
}
