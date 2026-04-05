import { useMobileRecoveryStore, type MobileRecoveryReason, type MobileRecoveryStep } from '../stores/mobileRecoveryStore';

export interface RecoveryJobContext {
  jobId: number;
  reason: MobileRecoveryReason;
  activeBackendId: string | null;
  selectedSessionId: string | null;
  throwIfCancelled: () => void;
  onCancel: (listener: () => void) => () => void;
}

export interface RecoveryJobDependencies {
  ensureTransportConnected: (ctx: RecoveryJobContext) => Promise<void>;
  ensureActiveBackendReady: (ctx: RecoveryJobContext) => Promise<void>;
  ensureActiveSessionReady: (ctx: RecoveryJobContext) => Promise<void>;
}

interface ActiveJob {
  jobId: number;
  cancelled: boolean;
  cancelListeners: Set<() => void>;
}

// Overall job timeout: individual steps have their own timeouts, but this
// guards against all steps collectively taking too long.
const OVERALL_JOB_TIMEOUT = 45_000;

// After this many consecutive failures, stop automatic retries.
// Manual retry() always works regardless of this limit.
const MAX_AUTO_RETRY_FAILURES = 3;

const defaultDependencies: RecoveryJobDependencies = {
  ensureTransportConnected: async () => {},
  ensureActiveBackendReady: async () => {},
  ensureActiveSessionReady: async () => {},
};

export class RecoveryJobManager {
  private nextJobId = 1;
  private activeJob: ActiveJob | null = null;
  private deps: RecoveryJobDependencies;
  private consecutiveFailures = 0;

  constructor(deps: Partial<RecoveryJobDependencies> = {}) {
    this.deps = {
      ...defaultDependencies,
      ...deps,
    };
  }

  setDependencies(deps: Partial<RecoveryJobDependencies>): void {
    this.deps = {
      ...this.deps,
      ...deps,
    };
  }

  updateSelection(activeBackendId: string | null, selectedSessionId: string | null): void {
    const prev = useMobileRecoveryStore.getState();
    const changed = prev.activeBackendId !== activeBackendId || prev.selectedSessionId !== selectedSessionId;
    useMobileRecoveryStore.getState().setSelection(activeBackendId, selectedSessionId);

    if (changed) {
      // New backend/session gets a fresh retry budget
      this.consecutiveFailures = 0;

      // If a job is running, cancel and restart with fresh selection
      if (this.activeJob && !this.activeJob.cancelled) {
        this.start('backend_reconnect');
      }
    }
  }

  start(reason: MobileRecoveryReason): number {
    // Block automatic retries after too many consecutive failures.
    // Manual retry (via retry()) bypasses this check.
    if (reason !== 'manual_retry' && this.consecutiveFailures >= MAX_AUTO_RETRY_FAILURES) {
      return -1;
    }

    if (this.activeJob) {
      this.cancel(this.activeJob.jobId, 'selection_change');
    }

    const jobId = this.nextJobId++;
    const activeJob: ActiveJob = { jobId, cancelled: false, cancelListeners: new Set() };
    this.activeJob = activeJob;
    useMobileRecoveryStore.getState().startJob(jobId, reason);

    void this.runJob(activeJob, reason);
    return jobId;
  }

  retry(): number {
    this.consecutiveFailures = 0;
    return this.start('manual_retry');
  }

  cancel(jobId?: number, reason?: 'background' | 'selection_change' | 'manual'): void {
    const current = this.activeJob;
    if (!current) return;
    if (jobId != null && current.jobId !== jobId) return;
    this.cancelActiveJob(current, reason);
  }

  dispose(): void {
    if (this.activeJob) {
      this.cancelActiveJob(this.activeJob, 'manual');
    }
  }

  private cancelActiveJob(job: ActiveJob, reason?: 'background' | 'selection_change' | 'manual'): void {
    job.cancelled = true;
    for (const listener of job.cancelListeners) {
      listener();
    }
    job.cancelListeners.clear();
    useMobileRecoveryStore.getState().cancelJob(job.jobId, reason);
    if (this.activeJob?.jobId === job.jobId) {
      this.activeJob = null;
    }
  }

  private async runJob(activeJob: ActiveJob, reason: MobileRecoveryReason): Promise<void> {
    const makeCtx = (): RecoveryJobContext => {
      const selection = useMobileRecoveryStore.getState();
      return {
        jobId: activeJob.jobId,
        reason,
        activeBackendId: selection.activeBackendId,
        selectedSessionId: selection.selectedSessionId,
        throwIfCancelled: () => {
          if (activeJob.cancelled) {
            throw new Error('Recovery job cancelled');
          }
        },
        onCancel: (listener) => {
          if (activeJob.cancelled) {
            listener();
            return () => {};
          }
          activeJob.cancelListeners.add(listener);
          return () => {
            activeJob.cancelListeners.delete(listener);
          };
        },
      };
    };

    // Overall job timeout guard — cleared on completion/cancel via cleanupTimeout
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const overallTimeout = new Promise<never>((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error('Overall recovery job timed out')), OVERALL_JOB_TIMEOUT);
      activeJob.cancelListeners.add(() => {
        if (timeoutId != null) { window.clearTimeout(timeoutId); timeoutId = null; }
      });
    });
    const cleanupTimeout = () => {
      if (timeoutId != null) { window.clearTimeout(timeoutId); timeoutId = null; }
    };

    try {
      await Promise.race([
        (async () => {
          await this.runStep(activeJob, makeCtx(), 'transport', this.deps.ensureTransportConnected);
          const backendCtx = makeCtx();
          await this.runStep(activeJob, backendCtx, 'backend', this.deps.ensureActiveBackendReady);

          const sessionCtx = makeCtx();
          if (sessionCtx.selectedSessionId) {
            await this.runStep(activeJob, sessionCtx, 'session', this.deps.ensureActiveSessionReady);
          }
        })(),
        overallTimeout,
      ]);

      if (!activeJob.cancelled) {
        this.consecutiveFailures = 0;
        useMobileRecoveryStore.getState().completeJob(activeJob.jobId);
      }
    } catch (error: unknown) {
      if (activeJob.cancelled) return;
      this.consecutiveFailures++;
      const message = error instanceof Error ? error.message : 'Recovery job failed';
      useMobileRecoveryStore.getState().failJob(activeJob.jobId, message);
    } finally {
      cleanupTimeout();
      if (this.activeJob?.jobId === activeJob.jobId) {
        this.activeJob = null;
      }
    }
  }

  private async runStep(
    activeJob: ActiveJob,
    ctx: RecoveryJobContext,
    step: Exclude<MobileRecoveryStep, null>,
    handler: (ctx: RecoveryJobContext) => Promise<void>,
  ): Promise<void> {
    if (activeJob.cancelled) {
      throw new Error('Recovery job cancelled');
    }
    useMobileRecoveryStore.getState().setStep(step);
    await handler(ctx);
    ctx.throwIfCancelled();
  }
}
