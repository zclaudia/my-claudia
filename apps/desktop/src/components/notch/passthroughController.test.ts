import { describe, expect, it, vi } from 'vitest';
import { createPassthroughController } from './passthroughController';

describe('createPassthroughController', () => {
  it('serializes passthrough updates so the latest state wins after an in-flight update', async () => {
    const resolvers: Array<() => void> = [];
    const apply = vi.fn(() => new Promise<void>((resolve) => {
      resolvers.push(resolve);
    }));
    const controller = createPassthroughController(apply);

    const first = controller.set(false);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(false);

    const latest = controller.set(true);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply).toHaveBeenLastCalledWith(false);

    resolvers[0]();
    await Promise.resolve();

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(true);

    resolvers[1]();
    await first;
    await latest;
  });

  it('retries the requested state after an apply failure', async () => {
    vi.useFakeTimers();
    const error = new Error('native failed');
    const onError = vi.fn();
    const apply = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce(undefined);
    const controller = createPassthroughController(apply, {
      retryDelayMs: 25,
      onError,
    });

    await expect(controller.set(true)).rejects.toThrow(error);

    expect(apply).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error, true);
    expect(controller.getState()).toMatchObject({
      requested: true,
      applied: null,
      inFlight: false,
      lastError: error,
    });

    await vi.advanceTimersByTimeAsync(25);

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(true);
    expect(controller.getState()).toMatchObject({
      requested: true,
      applied: true,
      inFlight: false,
      lastError: null,
    });

    controller.dispose();
    vi.useRealTimers();
  });

  it('applies the latest requested state when retrying after a failure', async () => {
    vi.useFakeTimers();
    const apply = vi.fn()
      .mockRejectedValueOnce(new Error('native failed'))
      .mockResolvedValueOnce(undefined);
    const controller = createPassthroughController(apply, { retryDelayMs: 100 });

    await expect(controller.set(true)).rejects.toThrow('native failed');
    await controller.set(false);

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenLastCalledWith(false);
    expect(controller.getState()).toMatchObject({
      requested: false,
      applied: false,
      inFlight: false,
      lastError: null,
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(apply).toHaveBeenCalledTimes(2);

    controller.dispose();
    vi.useRealTimers();
  });

  it('force reapplies an already-applied state when ensure is called', async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const controller = createPassthroughController(apply);

    await controller.set(true);
    await controller.ensure(true);

    expect(apply).toHaveBeenCalledTimes(2);
    expect(apply).toHaveBeenNthCalledWith(1, true);
    expect(apply).toHaveBeenNthCalledWith(2, true);
  });
});
