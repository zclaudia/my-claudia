type RunLike = {
  sessionId?: string;
  completed?: boolean;
  sessionType?: string;
};

/**
 * Foreground active run means:
 * - not completed
 * - not background session
 */
export function isForegroundActiveRun(run: RunLike | undefined): boolean {
  if (!run) return false;
  return !run.completed && run.sessionType !== 'background';
}

export function hasForegroundActiveRunForSession(
  activeRuns: Map<string, RunLike>,
  sessionId: string
): boolean {
  for (const run of activeRuns.values()) {
    if (run.sessionId === sessionId && isForegroundActiveRun(run)) {
      return true;
    }
  }
  return false;
}

export function findForegroundActiveRunIdForSession(
  activeRuns: Map<string, RunLike>,
  sessionId: string
): string | null {
  for (const [runId, run] of activeRuns) {
    if (run.sessionId === sessionId && isForegroundActiveRun(run)) {
      return runId;
    }
  }
  return null;
}

export function hasAnyActiveRunForSession(
  activeRuns: Map<string, RunLike>,
  sessionId: string
): boolean {
  for (const run of activeRuns.values()) {
    if (run.sessionId === sessionId && !run.completed) {
      return true;
    }
  }
  return false;
}
