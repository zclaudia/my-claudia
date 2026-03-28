import type { ActiveRun } from '../../ws/types.js';
import type { CancelRunOptions } from '../../ws/run-lifecycle.js';

export function cancelRunsForClosedChannel(
  channelId: string,
  activeRuns: Map<string, ActiveRun>,
  cancelRun: (runId: string, options?: CancelRunOptions) => void,
): void {
  for (const runId of Array.from(activeRuns.keys())) {
    const run = activeRuns.get(runId);
    if (!run || run.clientId !== channelId) continue;
    cancelRun(runId, {
      clientError: 'Gateway connection was interrupted',
      logLabel: 'Gateway-disconnected run',
    });
  }
}
