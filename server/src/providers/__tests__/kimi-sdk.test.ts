import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runKimi, abortKimiSession } from '../kimi-sdk.js';

vi.mock('child_process', () => ({
  spawn: vi.fn(),
}));

function createMockReadable(): Readable {
  return new Readable({ read() {} });
}

describe('kimi-sdk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('binds init session_id so abort can stop a newly created session', async () => {
    const stdout = createMockReadable();
    const stderr = createMockReadable();
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      killed: false,
      kill: vi.fn(function killMock(this: { killed: boolean }) {
        this.killed = true;
        return true;
      }),
    });
    vi.mocked(spawn).mockReturnValue(proc as any);

    const gen = runKimi('hello', { cwd: '/tmp' }, vi.fn());
    const first = gen.next();
    stdout.push(JSON.stringify({ type: 'init', session_id: 'kimi-session-1' }) + '\n');
    const firstMsg = await first;
    expect(firstMsg.value).toMatchObject({
      type: 'init',
      sessionId: 'kimi-session-1',
      systemInfo: {
        subscription: {
          provider: 'kimi',
          status: 'unavailable',
        },
      },
    });

    await abortKimiSession('kimi-session-1');
    expect(proc.kill).toHaveBeenCalledWith('SIGTERM');

    stdout.push(null);
    await gen.next();
  });

  it('yields an error instead of crashing when process stdout is unavailable', async () => {
    const proc = Object.assign(new EventEmitter(), {
      stdout: null,
      stderr: null,
      killed: false,
      kill: vi.fn(() => true),
    });
    vi.mocked(spawn).mockReturnValue(proc as any);

    const messages: any[] = [];
    for await (const msg of runKimi('hello', { cwd: '/tmp' }, vi.fn())) {
      messages.push(msg);
    }

    expect(messages.some((m) => m.type === 'error')).toBe(true);
  });
});
