import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { spawn } from 'child_process';
import { EventEmitter } from 'events';
import { Readable } from 'stream';
import { runClaudeReviewJob } from '../claude-review.js';

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

describe('runClaudeReviewJob', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(spawn).mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('extracts the final JSON verdict from stdout', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
      systemPrompt: 'Return only JSON.',
    });

    stdout.push('{"type":"final","decision":"approve","reasoning":"Read-only command.","confidence":0.91}');
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).resolves.toMatchObject({
      decision: 'approve',
      reasoning: 'Read-only command.',
      confidence: 0.91,
      exitCode: 0,
    });
  });

  it('fails when stdout does not contain a final JSON verdict', async () => {
    const { proc, stdout } = createMockProc();
    vi.mocked(spawn).mockReturnValue(proc as never);

    const resultPromise = runClaudeReviewJob({
      prompt: 'review prompt',
      cwd: '/tmp',
    });

    stdout.push('plain text only');
    stdout.push(null);
    proc.emit('close', 0);

    await expect(resultPromise).rejects.toThrow('Claude review job did not produce a valid final JSON result');
  });
});
