import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecoveryJobManager } from '../recoveryJobManager';
import { useMobileRecoveryStore } from '../../stores/mobileRecoveryStore';

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe('RecoveryJobManager', () => {
  beforeEach(() => {
    useMobileRecoveryStore.getState().reset();
    useMobileRecoveryStore.getState().setSelection(null, null);
  });

  it('starts one serial recovery job and completes it', async () => {
    const calls: string[] = [];
    const manager = new RecoveryJobManager({
      ensureTransportConnected: async () => { calls.push('transport'); },
      ensureActiveBackendReady: async () => { calls.push('backend'); },
      ensureActiveSessionReady: async () => { calls.push('session'); },
    });

    manager.updateSelection('b1', 's1');
    manager.start('resume');
    await flushMicrotasks();

    expect(calls).toEqual(['transport', 'backend', 'session']);
    expect(useMobileRecoveryStore.getState().phase).toBe('ready');
    expect(useMobileRecoveryStore.getState().currentJob.status).toBe('succeeded');
  });

  it('cancels an in-flight job when a new one starts', async () => {
    const blocker = deferred<void>();
    const firstTransport = vi.fn(async () => {
      await blocker.promise;
    });
    const secondTransport = vi.fn(async () => {});

    const manager = new RecoveryJobManager({
      ensureTransportConnected: async (ctx) => {
        if (ctx.reason === 'resume') {
          await firstTransport();
          return;
        }
        await secondTransport();
      },
      ensureActiveBackendReady: async () => {},
      ensureActiveSessionReady: async () => {},
    });

    manager.updateSelection('b1', 's1');
    const firstJobId = manager.start('resume');
    await flushMicrotasks();
    const secondJobId = manager.start('manual_retry');
    blocker.resolve();
    await flushMicrotasks();

    expect(firstJobId).not.toBe(secondJobId);
    expect(useMobileRecoveryStore.getState().currentJob.jobId).toBe(secondJobId);
    expect(useMobileRecoveryStore.getState().currentJob.status).toBe('succeeded');
    expect(secondTransport).toHaveBeenCalledOnce();
  });

  it('fails the current job when a recovery step throws', async () => {
    const manager = new RecoveryJobManager({
      ensureTransportConnected: async () => {},
      ensureActiveBackendReady: async () => {
        throw new Error('backend failed');
      },
      ensureActiveSessionReady: async () => {},
    });

    manager.updateSelection('b1', 's1');
    manager.start('resume');
    await flushMicrotasks();

    const state = useMobileRecoveryStore.getState();
    expect(state.phase).toBe('error');
    expect(state.currentJob.status).toBe('failed');
    expect(state.lastError).toBe('backend failed');
  });

  it('notifies in-flight waiters when the current job is cancelled', async () => {
    const cancelled = vi.fn();
    const manager = new RecoveryJobManager({
      ensureTransportConnected: async (ctx) => {
        await new Promise<void>((resolve) => {
          ctx.onCancel(() => {
            cancelled();
            resolve();
          });
        });
      },
      ensureActiveBackendReady: async () => {},
      ensureActiveSessionReady: async () => {},
    });

    manager.updateSelection('b1', 's1');
    const jobId = manager.start('resume');
    await flushMicrotasks();
    manager.cancel(jobId);
    await flushMicrotasks();

    const state = useMobileRecoveryStore.getState();
    expect(cancelled).toHaveBeenCalledOnce();
    expect(state.phase).toBe('idle');
    expect(state.currentJob.status).toBe('cancelled');
  });

  it('does not run the session step when no session is selected', async () => {
    const sessionStep = vi.fn(async () => {});
    const manager = new RecoveryJobManager({
      ensureTransportConnected: async () => {},
      ensureActiveBackendReady: async () => {},
      ensureActiveSessionReady: sessionStep,
    });

    manager.updateSelection('b1', null);
    manager.start('resume');
    await flushMicrotasks();

    expect(sessionStep).not.toHaveBeenCalled();
    expect(useMobileRecoveryStore.getState().phase).toBe('ready');
  });
});
