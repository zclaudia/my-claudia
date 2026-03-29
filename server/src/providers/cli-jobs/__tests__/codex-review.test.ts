import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runCodexReviewJob } from '../codex-review.js';

vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    mkdtempSync: vi.fn(() => '/tmp/codex-review-job'),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => '{"type":"final","decision":"approve","reasoning":"Read-only review.","confidence":0.77}'),
    rmSync: vi.fn(),
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

describe('runCodexReviewJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts the final JSON verdict from the output file', async () => {
    const { proc } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runCodexReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    proc.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'approve',
      reasoning: 'Read-only review.',
      confidence: 0.77,
      exitCode: 0,
    });
  });
});
