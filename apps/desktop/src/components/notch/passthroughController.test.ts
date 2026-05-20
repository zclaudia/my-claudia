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
});
