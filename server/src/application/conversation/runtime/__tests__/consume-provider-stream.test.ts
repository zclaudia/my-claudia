import { describe, expect, it, vi } from 'vitest';

const handleProviderEventMock = vi.fn();
const postRunCompletedNotificationMock = vi.fn();

vi.mock('../run-events.js', () => ({
  handleProviderEvent: handleProviderEventMock,
}));

vi.mock('../run-terminal-notifications.js', () => ({
  postRunCompletedNotification: postRunCompletedNotificationMock,
}));

describe('consumeProviderStream', () => {
  it('stops reading once a terminal provider event marks the run completed', async () => {
    const firstMessage = { type: 'result', content: 'done' };
    let nextCallCount = 0;

    const providerRunner: AsyncIterable<any> = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            nextCallCount += 1;
            if (nextCallCount === 1) {
              return Promise.resolve({ value: firstMessage, done: false });
            }
            return new Promise(() => {});
          },
        };
      },
    };

    handleProviderEventMock.mockImplementation(({ activeRun }: { activeRun: { completed?: boolean } }) => {
      activeRun.completed = true;
    });

    const { consumeProviderStream } = await import('../consume-provider-stream.js');

    const activeRun = {
      completed: false,
      lastActivityAt: 0,
      db: {},
    } as any;

    await Promise.race([
      consumeProviderStream({
        activeRun,
        activeRuns: new Map([['run-1', activeRun]]),
        broadcastHeartbeat: vi.fn(),
        client: {} as any,
        cwd: '/tmp',
        db: {} as any,
        input: 'hello',
        modeValue: 'default',
        notificationService: {} as any,
        notificationsService: undefined,
        persistSessionWorkingDirectory: vi.fn(),
        providerRunner,
        providerRegistry: {} as any,
        providerType: 'claude',
        runId: 'run-1',
        sendRunEvent: vi.fn(),
        sessionId: 'session-1',
        sessionType: 'regular',
        state: {},
        toolUseIdToName: new Map(),
        trace: { log: vi.fn(), setMeta: vi.fn() } as any,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('consumeProviderStream did not settle')), 100)),
    ]);

    expect(handleProviderEventMock).toHaveBeenCalledTimes(1);
    expect(activeRun.completed).toBe(true);
    expect(nextCallCount).toBe(1);
    expect(postRunCompletedNotificationMock).not.toHaveBeenCalled();
  });
});
