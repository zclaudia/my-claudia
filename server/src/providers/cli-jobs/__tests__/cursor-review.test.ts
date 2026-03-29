import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runCursorReviewJob } from '../cursor-review.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

function createMockReadable(): Readable {
  return new Readable({ read() {} });
}

function createMockProc() {
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
  return { proc, stdout, stderr };
}

describe('runCursorReviewJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts the final JSON verdict from assistant message blocks', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runCursorReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    stdout.push(JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          { type: 'text', text: '{"type":"final","decision":"approve","reasoning":"Safe command.","confidence":0.82}' },
        ],
      },
    }) + '\n');
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'approve',
      reasoning: 'Safe command.',
      confidence: 0.82,
      exitCode: 0,
    });
  });
});
